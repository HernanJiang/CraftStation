/**
 * Production Cloud Code gateway. `agy` and some Gemini CLI language-server
 * wrappers still default to the daily/staging host (`daily-cloudcode-pa`);
 * production OAuth tokens then EOF / RST the SSE stream.
 */
export const GOOGLE_CLOUDCODE_PRODUCTION_URL = "https://cloudcode-pa.googleapis.com";

export const GOOGLE_CLOUDCODE_PRODUCTION_ENV: Record<string, string> = {
  CODE_ASSIST_ENDPOINT: GOOGLE_CLOUDCODE_PRODUCTION_URL,
  BAICODE_ENDPOINT_URL: GOOGLE_CLOUDCODE_PRODUCTION_URL,
  AICODE_ENDPOINT_URL: GOOGLE_CLOUDCODE_PRODUCTION_URL,
  JETSKI_SERVICE_ENDPOINT_URL: GOOGLE_CLOUDCODE_PRODUCTION_URL,
};
