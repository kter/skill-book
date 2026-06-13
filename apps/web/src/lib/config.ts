export const config = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000",
  environment: process.env.NEXT_PUBLIC_ENVIRONMENT ?? "local",
  devAuthBypass: process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS === "true",
  cognitoUserPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID ?? "",
  cognitoClientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID ?? "",
  cognitoDomain: process.env.NEXT_PUBLIC_COGNITO_DOMAIN ?? "",
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
};

export function cognitoRegion(): string {
  return config.cognitoUserPoolId.split("_")[0] ?? "ap-northeast-1";
}
