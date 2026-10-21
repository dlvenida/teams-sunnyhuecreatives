import { formatApiError } from "@/lib/errors"

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8090"

export { API_URL }

export type UserRole = "admin" | "auditor" | "va"

export interface AuthUser {
  role: UserRole
  username?: string
  name?: string
  vaId?: string
  userId?: string
  mustChangePassword?: boolean
  isImpersonating?: boolean
  impersonatedBy?: string
  impersonatedByName?: string
}

export interface LoginResponse {
  access_token: string
  refresh_token: string
  role: UserRole
  username?: string
  name?: string
  va_id?: string
  user_id?: string
  must_change_password?: boolean
  is_impersonating?: boolean
  impersonated_by?: string
  impersonated_by_name?: string
}

const IMPERSONATION_KEY = "impersonation_backup"

export interface ImpersonationBackup {
  access: string | null
  refresh: string | null
  user: AuthUser | null
  targetName?: string
  targetRole?: string
}

export function getImpersonationBackup(): ImpersonationBackup | null {
  try {
    const raw = localStorage.getItem(IMPERSONATION_KEY)
    return raw ? (JSON.parse(raw) as ImpersonationBackup) : null
  } catch { return null }
}
export function isImpersonating(): boolean {
  return !!getImpersonationBackup() || !!getAuthUser()?.isImpersonating
}

/** Admin → view exactly what `userId` sees. Keeps the admin session to restore. */
export async function startImpersonation(userId: string): Promise<AuthUser> {
  if (getImpersonationBackup()) throw new Error("Already viewing as another user — exit that view first")
  const backup: ImpersonationBackup = {
    access: localStorage.getItem("access_token"),
    refresh: localStorage.getItem("refresh_token"),
    user: getAuthUser(),
  }
  const data = await apiFetch<LoginResponse>(`/auth/impersonate/${userId}`, { method: "POST" })
  localStorage.setItem(IMPERSONATION_KEY, JSON.stringify({ ...backup, targetName: data.name, targetRole: data.role }))
  setTokens(data.access_token, data.refresh_token)
  const user: AuthUser = {
    role: data.role, name: data.name, vaId: data.va_id, userId: data.user_id,
    mustChangePassword: false, isImpersonating: true,
    impersonatedBy: data.impersonated_by, impersonatedByName: data.impersonated_by_name,
  }
  setAuthUser(user)
  return user
}

/** Restore the original administrator session. Returns false if none saved. */
export function exitImpersonation(): boolean {
  const backup = getImpersonationBackup()
  localStorage.removeItem(IMPERSONATION_KEY)
  if (!backup?.access || !backup?.refresh || !backup.user) { clearTokens(); return false }
  setTokens(backup.access, backup.refresh)
  setAuthUser(backup.user)
  return true
}

export function homeForRole(role: UserRole): string {
  return role === "admin" ? "/admin/dashboard" : role === "auditor" ? "/admin/analytics" : "/va/dashboard"
}

function getTokens() {
  return {
    access: localStorage.getItem("access_token"),
    refresh: localStorage.getItem("refresh_token"),
  }
}

export function setTokens(access: string, refresh: string) {
  localStorage.setItem("access_token", access)
  localStorage.setItem("refresh_token", refresh)
}

export function clearTokens() {
  localStorage.removeItem("access_token")
  localStorage.removeItem("refresh_token")
  localStorage.removeItem("auth_user")
  localStorage.removeItem(IMPERSONATION_KEY)
}

export function setAuthUser(user: AuthUser) {
  localStorage.setItem("auth_user", JSON.stringify(user))
}

export function getAuthUser(): AuthUser | null {
  const raw = localStorage.getItem("auth_user")
  return raw ? JSON.parse(raw) : null
}

async function refreshAccessToken(): Promise<string | null> {
  const { refresh } = getTokens()
  if (!refresh) return null
  const res = await fetch(`${API_URL}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refresh }),
  })
  if (!res.ok) {
    clearTokens()
    return null
  }
  const data: LoginResponse = await res.json()
  setTokens(data.access_token, data.refresh_token)
  setAuthUser({
    role: data.role,
    username: data.username,
    name: data.name,
    vaId: data.va_id,
    userId: data.user_id,
    mustChangePassword: data.must_change_password,
    isImpersonating: data.is_impersonating,
    impersonatedBy: data.impersonated_by,
    impersonatedByName: data.impersonated_by_name,
  })
  return data.access_token
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  let { access } = getTokens()
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  }
  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = headers["Content-Type"] || "application/json"
  }
  if (access) headers["Authorization"] = `Bearer ${access}`

  let res = await fetch(`${API_URL}${path}`, { ...options, headers })

  if (res.status === 401 && getTokens().refresh) {
    access = await refreshAccessToken()
    if (access) {
      headers["Authorization"] = `Bearer ${access}`
      res = await fetch(`${API_URL}${path}`, { ...options, headers })
    }
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(formatApiError(err.detail, res.statusText || "Request failed"))
  }

  if (res.status === 204) return undefined as T
  const ct = res.headers.get("content-type")
  if (ct?.includes("text/csv")) return (await res.text()) as T
  return res.json()
}

export async function apiFetchBlob(path: string): Promise<Blob | null> {
  let { access } = getTokens()
  const headers: Record<string, string> = {}
  if (access) headers["Authorization"] = `Bearer ${access}`

  let res = await fetch(`${API_URL}${path}`, { headers })
  if (res.status === 401 && getTokens().refresh) {
    access = await refreshAccessToken()
    if (access) {
      headers["Authorization"] = `Bearer ${access}`
      res = await fetch(`${API_URL}${path}`, { headers })
    }
  }
  if (res.status === 404) return null
  if (!res.ok) throw new Error("Failed to load resource")
  return res.blob()
}

export async function pinLogin(username: string, pin: string): Promise<AuthUser> {
  const data = await apiFetch<LoginResponse>("/auth/pin-login", {
    method: "POST",
    body: JSON.stringify({ username, pin }),
  })
  localStorage.removeItem(IMPERSONATION_KEY)
  setTokens(data.access_token, data.refresh_token)
  const user: AuthUser = {
    role: data.role,
    username: data.username,
    name: data.name,
    vaId: data.va_id,
    userId: data.user_id,
    mustChangePassword: data.must_change_password,
  }
  setAuthUser(user)
  return user
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const data = await apiFetch<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  })
  localStorage.removeItem(IMPERSONATION_KEY)
  setTokens(data.access_token, data.refresh_token)
  const user: AuthUser = {
    role: data.role,
    username: data.username,
    name: data.name,
    vaId: data.va_id,
    userId: data.user_id,
    mustChangePassword: data.must_change_password,
  }
  setAuthUser(user)
  return user
}

export function logout() {
  clearTokens()
  window.location.href = "/login"
}
