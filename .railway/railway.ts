import { bucket, defineRailway, github, postgres, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const teamsSunnyhuecreatives = github("dlvenida/teams-sunnyhuecreatives", { branch: "main", checkSuites: false });

  const Postgres = postgres("Postgres", { region: "asia-southeast1-eqsg3a" });
  Postgres.networking = { privateNetworkEndpoint: "postgres" };
  const postgresVolume = volume("postgres-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "asia-southeast1-eqsg3a", sizeMB: 50000 });
  const teamsShcUploads = bucket("teams-shc-uploads", { region: "sin" });

  const api = service("api", {
    source: teamsSunnyhuecreatives,
    rootDirectory: "backend",
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "Dockerfile", watchPatterns: ["backend/**"] },
    deploy: {
      // No startCommand: the Dockerfile CMD runs migrations + uvicorn with a
      // ${PORT:-8090} fallback, which is more reliable than overriding here.
      healthcheckPath: "/health",
      healthcheckTimeout: 300,
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 3,
    },
    replicas: { "asia-southeast1-eqsg3a": 1 },
  });

  const web = service("web", {
    source: teamsSunnyhuecreatives,
    rootDirectory: "frontend",
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "Dockerfile", watchPatterns: ["frontend/**"] },
    deploy: {
      healthcheckPath: "/",
      healthcheckTimeout: 300,
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 3,
    },
    replicas: { "asia-southeast1-eqsg3a": 1 },
  });

  return project("Team Sunny Hue Creatives", {
    variables: { managed: false },
    resources: [web, api, Postgres, postgresVolume, teamsShcUploads],
  });
});
