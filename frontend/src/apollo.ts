import { ApolloClient, InMemoryCache } from "@apollo/client";

// Same-origin "/graphql": proxied to the BFF by Vite in dev, routed by Caddy in prod.
export const apollo = new ApolloClient({
  uri: "/graphql",
  cache: new InMemoryCache(),
  credentials: "include",
});
