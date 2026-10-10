import { describe, expect, it } from "vitest";
import { InsecureEndpointError, requireSecureEndpoint } from "./transport_security.js";

describe("requireSecureEndpoint", () => {
  it.each(["https://sui.example", "https://sui.example:8443/base", "http://localhost:8000", "http://127.0.0.1:8000", "http://[::1]:8000"])(
    "accepts %s",
    (raw) => {
      expect(requireSecureEndpoint(raw, "X").href).toContain("://");
    },
  );

  it.each([
    ["http://sui.example", "must be https"],
    ["ftp://sui.example", "must be https"],
    ["https://user:pw@sui.example", "credentials"],
    ["https://sui.example/#frag", "fragment"],
    ["not a url", "not a valid URL"],
    ["", "not a valid URL"],
  ])("rejects %s", (raw, message) => {
    expect(() => requireSecureEndpoint(raw, "X")).toThrow(InsecureEndpointError);
    expect(() => requireSecureEndpoint(raw, "X")).toThrow(message);
  });
});
