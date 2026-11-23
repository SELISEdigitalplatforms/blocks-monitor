/** Calls the BFF /api/idp/initiate (which proxies to iam.seliseblocks.com) and redirects to the IAM login page. */
export async function redirectToIamLogin(flow?: "signup"): Promise<void> {
  const redirectUri = `${window.location.origin}/login/callback`;

  const params = new URLSearchParams({ redirectUri });
  if (flow) params.set("flow", flow);

  // Store where to return after login
  sessionStorage.setItem("madp-factory-oidc-attempt-v1", JSON.stringify({ returnTo: "/dashboard", at: Date.now() }));

  const res = await fetch(`/api/idp/initiate?${params.toString()}`, {
    headers: { accept: "application/json", "content-type": "application/json" },
  });
  const data = await res.json() as { redirect_uri?: string };
  if (data.redirect_uri) {
    window.location.href = data.redirect_uri;
  } else {
    window.location.href = "/sign-in";
  }
}
