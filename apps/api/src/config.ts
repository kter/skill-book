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
  /** When true, generate per-version content explanations via Bedrock at publish time. */
  bedrockEnabled: boolean;
  /** Region for Bedrock inference (may differ from awsRegion). */
  bedrockRegion: string;
  /** Bedrock model / inference-profile id used to summarize artifact content. */
  bedrockModelId: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const clientIds = [env.COGNITO_WEB_CLIENT_ID, env.COGNITO_CLI_CLIENT_ID].filter(
    (v): v is string => Boolean(v),
  );
  const bypassTokens = [
    env.INTEGRATION_TEST_BYPASS_TOKEN,
    env.INTEGRATION_TEST_BYPASS_TOKEN_2,
  ].filter((v): v is string => Boolean(v));
  const environment = env.ENVIRONMENT ?? "local";
  const awsRegion = env.AWS_REGION ?? "ap-northeast-1";
  return {
    environment,
    databaseUrl: env.DATABASE_URL,
    dsqlClusterEndpoint: env.DSQL_CLUSTER_ENDPOINT || undefined,
    awsRegion,
    artifactsBucket: env.ARTIFACTS_BUCKET,
    cognitoUserPoolId: env.COGNITO_USER_POOL_ID,
    cognitoClientIds: clientIds,
    cognitoDomain: env.COGNITO_DOMAIN,
    cognitoCliClientId: env.COGNITO_CLI_CLIENT_ID,
    corsOrigins: (env.CORS_ORIGINS ?? "http://localhost:3000").split(",").map((s) => s.trim()),
    integrationBypassTokens: bypassTokens,
    maxZipBytes: 10 * 1024 * 1024,
    // Off locally by default (no creds); Terraform sets BEDROCK_ENABLED=true on dev/prd.
    bedrockEnabled:
      (env.BEDROCK_ENABLED ?? (environment === "local" ? "false" : "true")) === "true",
    bedrockRegion: env.BEDROCK_REGION ?? awsRegion,
    bedrockModelId: env.BEDROCK_MODEL_ID ?? "jp.anthropic.claude-sonnet-4-6",
  };
}
