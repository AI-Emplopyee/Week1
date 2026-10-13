// The application owns its HTTP entry point. Authentication is enforced by
// server-auth for API requests; local development also uses the loopback gate.
export { default } from "vinext/server/fetch-handler";
