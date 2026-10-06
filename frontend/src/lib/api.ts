import { formatApiError } from "@/lib/errors"

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8090"

export { API_URL }

export type UserRole = "admin" | "va"

export interface AuthUser {
  role: UserRole
  name?: string
  vaId?: string
  mustChangePassword?: boolean
}

export interface LoginResponse {
  access_token: string
  refresh_token: string
  role: UserRole
  name?: string
  va_id?: string
  must_change_password?: boolean
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
    name: data.name,
    vaId: data.va_id,
    mustChangePassword: data.must_change_password,
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

export async function login(email: string, password: string): Promise<AuthUser> {
  const data = await apiFetch<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  })
  setTokens(data.access_token, data.refresh_token)
  const user: AuthUser = {
    role: data.role,
    name: data.name,
    vaId: data.va_id,
    mustChangePassword: data.must_change_password,
  }
  setAuthUser(user)
  return user
}

export function logout() {
  clearTokens()
  window.location.href = "/login"
}
