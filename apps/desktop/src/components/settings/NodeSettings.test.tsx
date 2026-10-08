import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Endpoint } from "../../protocol/connection";
import { loadNodes } from "../../nodes";
import { loadDeviceToken } from "../../settings";
import NodeSettings from "./NodeSettings";

const LOCAL: Endpoint = { host: "127.0.0.1", port: 49777 };

afterEach(() => {
  localStorage.clear();
});

describe("NodeSettings", () => {
  it("lists the current connection as the first node", () => {
    render(
      <NodeSettings endpoint={LOCAL} onChangeEndpoint={vi.fn<(endpoint: Endpoint) => void>()} />,
    );
    expect(screen.getByText("(connected)")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Switch to 127.0.0.1" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("saves a node and switches to it with its device token", () => {
    const onChange = vi.fn<(endpoint: Endpoint) => void>();
    render(<NodeSettings endpoint={LOCAL} onChangeEndpoint={onChange} />);
    fireEvent.change(screen.getByLabelText("Node name"), { target: { value: "Ubuntu" } });
    fireEvent.change(screen.getByLabelText("Node host"), { target: { value: "192.168.1.3" } });
    fireEvent.change(screen.getByLabelText("Node device token"), { target: { value: "tok" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(loadNodes().map((node) => node.name)).toEqual(["127.0.0.1", "Ubuntu"]);
    fireEvent.click(screen.getByRole("button", { name: "Switch to Ubuntu" }));
    expect(loadDeviceToken()).toBe("tok");
    expect(onChange).toHaveBeenCalledWith({ host: "192.168.1.3", port: 49777 });
  });

  it("removes a node", () => {
    render(
      <NodeSettings endpoint={LOCAL} onChangeEndpoint={vi.fn<(endpoint: Endpoint) => void>()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove 127.0.0.1" }));
    expect(loadNodes()).toEqual([]);
  });
});
