// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "../lib/queryKeys";
import { AuthPage } from "./Auth";

const getSessionMock = vi.hoisted(() => vi.fn());
const signInEmailMock = vi.hoisted(() => vi.fn());
const signUpEmailMock = vi.hoisted(() => vi.fn());
const healthGetMock = vi.hoisted(() => vi.fn());
const signInWithKeycloakMock = vi.hoisted(() => vi.fn());

vi.mock("../api/auth", () => ({
  authApi: {
    getSession: () => getSessionMock(),
    signInEmail: (input: unknown) => signInEmailMock(input),
    signUpEmail: (input: unknown) => signUpEmailMock(input),
    signInWithKeycloak: (input: unknown) => signInWithKeycloakMock(input),
  },
}));

vi.mock("../api/health", () => ({
  healthApi: {
    get: () => healthGetMock(),
  },
}));

// The ASCII art animation drives a canvas/requestAnimationFrame loop that adds
// nothing to these assertions, so stub it out.
vi.mock("@/components/AsciiArtAnimation", () => ({
  AsciiArtAnimation: () => null,
}));

// The auth page renders a ThemeToggle, which reads ThemeContext. The provider
// lives in main.tsx (above the router), so mock the hook here the same way
// SidebarAccountMenu.test.tsx does.
vi.mock("../context/ThemeContext", () => ({
  useTheme: () => ({
    theme: "dark",
    setTheme: vi.fn(),
    toggleTheme: vi.fn(),
  }),
}));

// The router's navigate wrapper reads the active company prefix from context.
vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompany: null,
    selectedCompanyId: null,
    companies: [],
    selectionSource: "manual",
    loading: false,
    error: null,
    setSelectedCompanyId: vi.fn(),
    reloadCompanies: vi.fn(),
    createCompany: vi.fn(),
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function act(callback: () => void | Promise<void>) {
  let result: void | Promise<void> = undefined;
  flushSync(() => {
    result = callback();
  });
  await result;
}

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
  flushSync(() => {});
}

function renderAuthPage(container: HTMLElement) {
  const root = createRoot(container);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return { root, queryClient };
}

describe("AuthPage", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    getSessionMock.mockResolvedValue(null);
    signInEmailMock.mockResolvedValue(undefined);
    signUpEmailMock.mockResolvedValue(undefined);
    healthGetMock.mockResolvedValue({ status: "ok" });
    signInWithKeycloakMock.mockResolvedValue("https://sso.example.test/realms/pilot/protocol/openid-connect/auth?client_id=pilot-board");
  });

  afterEach(() => {
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  async function mountWithRoute(initialEntry = "/auth") {
    const { root, queryClient } = renderAuthPage(container);
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[initialEntry]}>
          <QueryClientProvider client={queryClient}>
            <Routes>
              <Route path="/auth" element={<AuthPage />} />
            </Routes>
          </QueryClientProvider>
        </MemoryRouter>,
      );
    });
    await flushReact();
    await flushReact();
    return { root, queryClient };
  }

  async function mount() {
    return mountWithRoute("/auth");
  }

  it("exposes password-manager metadata and a11y attributes on the sign-in form", async () => {
    const { root } = await mount();

    const emailInput = container.querySelector('input[name="email"]') as HTMLInputElement;
    const passwordInput = container.querySelector('input[name="password"]') as HTMLInputElement;

    expect(emailInput).not.toBeNull();
    expect(passwordInput).not.toBeNull();

    // 1Password / password-manager recognition: identifier field is "username".
    expect(emailInput.getAttribute("autocomplete")).toBe("username");
    expect(emailInput.getAttribute("type")).toBe("email");
    expect(passwordInput.getAttribute("autocomplete")).toBe("current-password");

    // Stable ids/names for both inputs.
    expect(emailInput.id).toBe("email");
    expect(passwordInput.id).toBe("password");

    // Required + programmatic required state.
    expect(emailInput.required).toBe(true);
    expect(emailInput.getAttribute("aria-required")).toBe("true");
    expect(passwordInput.required).toBe(true);
    expect(passwordInput.getAttribute("aria-required")).toBe("true");

    // Programmatic labels.
    expect(container.querySelector('label[for="email"]')).not.toBeNull();
    expect(container.querySelector('label[for="password"]')).not.toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it("uses new-password autocomplete in sign-up mode", async () => {
    const { root } = await mount();

    const createOne = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Create one",
    );
    expect(createOne).not.toBeNull();

    await act(async () => {
      createOne?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushReact();

    const nameInput = container.querySelector('input[name="name"]') as HTMLInputElement;
    const passwordInput = container.querySelector('input[name="password"]') as HTMLInputElement;
    expect(nameInput).not.toBeNull();
    expect(nameInput.getAttribute("autocomplete")).toBe("name");
    expect(nameInput.required).toBe(true);
    expect(passwordInput.getAttribute("autocomplete")).toBe("new-password");

    await act(async () => {
      root.unmount();
    });
  });

  it("renders auth errors in an assertive alert region referenced by the inputs", async () => {
    const { root } = await mount();

    const inputValueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    const emailInput = container.querySelector('input[name="email"]') as HTMLInputElement;
    const passwordInput = container.querySelector('input[name="password"]') as HTMLInputElement;

    await act(async () => {
      inputValueSetter!.call(emailInput, "jane@example.com");
      emailInput.dispatchEvent(new Event("input", { bubbles: true }));
      inputValueSetter!.call(passwordInput, "wrongpass");
      passwordInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    signInEmailMock.mockRejectedValueOnce(new Error("Invalid email or password"));

    const form = container.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flushReact();
    await flushReact();

    const alert = container.querySelector('[role="alert"]') as HTMLElement;
    expect(alert).not.toBeNull();
    expect(alert.hasAttribute("aria-live")).toBe(false);
    expect(alert.textContent).toContain("Invalid email or password");

    const errorId = alert.id;
    expect(errorId.length).toBeGreaterThan(0);
    expect(emailInput.getAttribute("aria-describedby")).toBe(errorId);
    expect(emailInput.getAttribute("aria-invalid")).toBe("true");
    expect(passwordInput.getAttribute("aria-describedby")).toBe(errorId);
    expect(passwordInput.getAttribute("aria-invalid")).toBe("true");

    await act(async () => {
      root.unmount();
    });
  });

  it("invalidates anonymous health metadata after sign-in", async () => {
    const { root, queryClient } = await mount();
    // The auth page itself subscribes to /api/health (SSO button visibility),
    // so a successful sign-in must refetch it: the mounted query is how the
    // invalidation becomes observable without reaching into internals.
    const healthCallsBefore = healthGetMock.mock.calls.length;
    queryClient.setQueryData(queryKeys.health, {
      status: "ok",
      deploymentMode: "authenticated",
    });

    const inputValueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    const emailInput = container.querySelector('input[name="email"]') as HTMLInputElement;
    const passwordInput = container.querySelector('input[name="password"]') as HTMLInputElement;

    await act(async () => {
      inputValueSetter!.call(emailInput, "jane@example.com");
      emailInput.dispatchEvent(new Event("input", { bubbles: true }));
      inputValueSetter!.call(passwordInput, "supersecret");
      passwordInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const form = container.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flushReact();
    await flushReact();

    expect(signInEmailMock).toHaveBeenCalledWith({
      email: "jane@example.com",
      password: "supersecret",
    });
    await flushReact();
    expect(healthGetMock.mock.calls.length).toBeGreaterThan(healthCallsBefore);

    await act(async () => {
      root.unmount();
    });
  });

  it("hides the SSO button when the instance does not advertise keycloak", async () => {
    healthGetMock.mockResolvedValue({ status: "ok", authSsoProviders: [] });
    const { root } = await mount();

    expect(container.textContent).not.toContain("Sign in with Patty");
    // Email sign-in remains the path on non-SSO instances.
    expect(container.querySelector('input[name="email"]')).not.toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it("renders SSO-only sign-in when the instance advertises keycloak", async () => {
    healthGetMock.mockResolvedValue({ status: "ok", authSsoProviders: ["keycloak"] });
    const { root } = await mount();
    await flushReact();

    // No email form, no account-creation toggle — SSO is the only path.
    expect(container.querySelector('input[name="email"]')).toBeNull();
    expect(container.querySelector('input[name="password"]')).toBeNull();
    expect(container.textContent).not.toContain("Create one");
    expect(container.textContent).not.toContain("email and password");
    expect(container.textContent).toContain("Use your Patty account");
    expect(container.textContent).toContain("Sign in with Patty");

    await act(async () => {
      root.unmount();
    });
  });

  it("starts the keycloak flow when the SSO button is clicked", async () => {
    healthGetMock.mockResolvedValue({ status: "ok", authSsoProviders: ["keycloak"] });
    const { root } = await mount();
    await flushReact();

    const ssoButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Sign in with Patty",
    );
    expect(ssoButton).not.toBeNull();

    const originalLocation = window.location;
    const assignMock = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...originalLocation, assign: assignMock },
      configurable: true,
      writable: true,
    });

    try {
      await act(async () => {
        ssoButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      await flushReact();

      expect(signInWithKeycloakMock).toHaveBeenCalledWith({
        callbackUrl: new URL("/", window.location.origin).href,
        errorCallbackUrl: new URL("/auth?sso_error=1", originalLocation.origin).href,
      });
      expect(assignMock).toHaveBeenCalledWith(
        "https://sso.example.test/realms/pilot/protocol/openid-connect/auth?client_id=pilot-board",
      );
    } finally {
      Object.defineProperty(window, "location", {
        value: originalLocation,
        configurable: true,
        writable: true,
      });
    }

    await act(async () => {
      root.unmount();
    });
  });

  it("surfaces the SSO failure message when redirected back with sso_error", async () => {
    const { root } = await mountWithRoute("/auth?sso_error=1");

    expect(container.textContent).toContain("Sign-in with SSO did not complete");

    await act(async () => {
      root.unmount();
    });
  });
});
