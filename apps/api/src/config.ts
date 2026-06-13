export interface ApiConfig {
  environment: string; // "local" | "dev" | "prd"
  databaseUrl: string | undefined;
  dsqlClusterEndpoint: string | undefined;
  awsRegion: string;
  artifactsBucket: string | undefined;
  cognitoUserPoolId: string | undefined;
  cognitoClientIds: string[];
  cognitoDomain: string | undefined;
  cognitoCliClientId: string | undefined;
  corsOrigins: string[];
  integrationBypassTokens: string[];
  /** Max staged zip size accepted at publish time. */
  maxZipBytes: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const clientIds = [env.COGNITO_WEB_CLIENT_ID, env.COGNITO_CLI_CLIENT_ID].filter(
    (v): v is string => Boolean(v),
  );
  const bypassTokens = [
    env.INTEGRATION_TEST_BYPASS_TOKEN,
    env.INTEGRATION_TEST_BYPASS_TOKEN_2,
  ].filter((v): v is string => Boolean(v));
  return {
    environment: env.ENVIRONMENT ?? "local",
    databaseUrl: env.DATABASE_URL,
    dsqlClusterEndpoint: env.DSQL_CLUSTER_ENDPOINT || undefined,
    awsRegion: env.AWS_REGION ?? "ap-northeast-1",
    artifactsBucket: env.ARTIFACTS_BUCKET,
    cognitoUserPoolId: env.COGNITO_USER_POOL_ID,
    cognitoClientIds: clientIds,
    cognitoDomain: env.COGNITO_DOMAIN,
    cognitoCliClientId: env.COGNITO_CLI_CLIENT_ID,
    corsOrigins: (env.CORS_ORIGINS ?? "http://localhost:3000").split(",").map((s) => s.trim()),
    integrationBypassTokens: bypassTokens,
    maxZipBytes: 10 * 1024 * 1024,
  };
}
