import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Database } from "lucide-react";
import { ErrorDisplay } from "@/components/common/error-display/error-display";
import { ErrorBoundary } from "@/components/common/error-boundary/error-boundary";
import { MaskedText } from "@/components/common/masked-text";
import { RenderConditionally } from "@/components/common/render-elements/render-conditionally";
import { RenderAlternatively } from "@/components/common/render-elements/render-alternatively";
import { CopyToClipboardButton } from "@/components/common/copy-to-clipboard/button";
import { InfoTooltip } from "@/components/common/info-tool-tip/info-tool-tip";
import LoadingSpinner from "@/components/common/loader-spinner/loader-spinner";
import { BackIconButton } from "@/components/common/buttons";
import { PasswordInput } from "@/components/common/password-input/password-input";

describe("ErrorDisplay", () => {
  it("renders the provided text and a custom icon", () => {
    render(<ErrorDisplay text="Boom" icon={Database} />);
    expect(screen.getByText("Boom")).toBeInTheDocument();
  });

  it("renders without text when none is given", () => {
    const { container } = render(<ErrorDisplay />);
    expect(container.querySelector("p")).toBeNull();
  });
});

describe("ErrorBoundary", () => {
  const Boom = () => {
    throw new Error("kaboom");
  };

  afterEach(() => vi.restoreAllMocks());

  it("renders children when there is no error", () => {
    render(
      <ErrorBoundary>
        <span>safe child</span>
      </ErrorBoundary>,
    );
    expect(screen.getByText("safe child")).toBeInTheDocument();
  });

  it("renders the default fallback on error", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText("kaboom")).toBeInTheDocument();
  });

  it("renders a custom fallback when provided", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary fallback={<span>custom fallback</span>}>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText("custom fallback")).toBeInTheDocument();
  });
});

describe("MaskedText", () => {
  it("masks everything by default", () => {
    const { container } = render(<MaskedText text="secret" />);
    expect(container.textContent).toBe("******");
  });

  it("reveals first and last N characters", () => {
    const { container } = render(
      <MaskedText text="1234567890" showFirstN={2} showLastN={2} />,
    );
    expect(container.textContent).toBe("12******90");
  });

  it("uses a custom mask character and explicit length", () => {
    const { container } = render(
      <MaskedText text="ab" length={4} char="#" />,
    );
    expect(container.textContent).toBe("####");
  });
});

describe("Render elements", () => {
  it("RenderConditionally shows children only when condition is true", () => {
    const { rerender, container } = render(
      <RenderConditionally condition={false}>
        <span>hi</span>
      </RenderConditionally>,
    );
    expect(container.textContent).toBe("");
    rerender(
      <RenderConditionally condition={true}>
        <span>hi</span>
      </RenderConditionally>,
    );
    expect(screen.getByText("hi")).toBeInTheDocument();
  });

  it("RenderAlternatively picks the branch by condition", () => {
    const { rerender } = render(
      <RenderAlternatively condition={true}>
        {[<span key="t">T</span>, <span key="f">F</span>]}
      </RenderAlternatively>,
    );
    expect(screen.getByText("T")).toBeInTheDocument();
    rerender(
      <RenderAlternatively condition={false}>
        {[<span key="t">T</span>, <span key="f">F</span>]}
      </RenderAlternatively>,
    );
    expect(screen.getByText("F")).toBeInTheDocument();
  });
});

describe("CopyToClipboardButton", () => {
  afterEach(() => vi.restoreAllMocks());

  it("copies text via the clipboard API on click", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    Object.defineProperty(window, "isSecureContext", {
      value: true,
      configurable: true,
    });

    render(
      <CopyToClipboardButton textToCopy="copy-me">
        <span>label</span>
      </CopyToClipboardButton>,
    );
    await userEvent.click(screen.getByRole("button"));
    expect(writeText).toHaveBeenCalledWith("copy-me");
  });

  it("falls back to execCommand in an insecure context", async () => {
    Object.assign(navigator, { clipboard: undefined });
    Object.defineProperty(window, "isSecureContext", {
      value: false,
      configurable: true,
    });
    const exec = vi.fn();
    // @ts-expect-error jsdom lacks execCommand
    document.execCommand = exec;

    render(
      <CopyToClipboardButton textToCopy="legacy" isHoverEnabled>
        <span>label</span>
      </CopyToClipboardButton>,
    );
    await userEvent.click(screen.getByRole("button"));
    expect(exec).toHaveBeenCalledWith("copy");
  });
});

describe("InfoTooltip + LoadingSpinner + BackIconButton", () => {
  it("InfoTooltip renders its trigger", () => {
    render(<InfoTooltip content="help text" side="right" />);
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("LoadingSpinner renders a label by default and hides it when empty", () => {
    const { rerender } = render(<LoadingSpinner />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
    rerender(<LoadingSpinner variant="fullscreen" label="" />);
    expect(screen.queryByText("Loading...")).toBeNull();
  });

  it("BackIconButton fires onClick", async () => {
    const onClick = vi.fn();
    render(<BackIconButton onClick={onClick} />);
    await userEvent.click(screen.getByLabelText("Go back"));
    expect(onClick).toHaveBeenCalled();
  });
});

describe("PasswordInput", () => {
  it("toggles between password and text types", () => {
    render(<PasswordInput placeholder="pwd" />);
    const input = screen.getByPlaceholderText("pwd") as HTMLInputElement;
    expect(input.type).toBe("password");
    fireEvent.click(screen.getByRole("button"));
    expect(input.type).toBe("text");
    fireEvent.click(screen.getByRole("button"));
    expect(input.type).toBe("password");
  });

  it("forwards a ref to the input", () => {
    let node: HTMLInputElement | null = null;
    render(<PasswordInput ref={(n) => (node = n)} />);
    expect(node).toBeInstanceOf(HTMLInputElement);
  });
});

describe("Spinner findBy async smoke", () => {
  it("renders spinner in inline variant", async () => {
    render(<LoadingSpinner variant="inline" label="wait" />);
    await waitFor(() => expect(screen.getByText("wait")).toBeInTheDocument());
  });
});
