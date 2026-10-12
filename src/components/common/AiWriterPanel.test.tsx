import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AiWriterPanel } from "./AiWriterPanel";

afterEach(cleanup);

describe("AiWriterPanel", () => {
  it("needs a brief, passes options to onGenerate, and offers undo", async () => {
    const undo = vi.fn();
    const onGenerate = vi.fn().mockResolvedValue(undo);
    render(<AiWriterPanel kind="article" onGenerate={onGenerate} hasContent />);
    fireEvent.click(screen.getByRole("button", { name: /Write with AI/ }));
    const go = screen.getAllByRole("button", { name: /Write with AI/ }).at(-1)!;
    expect(go).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/What should this article cover/), { target: { value: "How clinics use chatbots" } });
    fireEvent.change(screen.getByLabelText("Length"), { target: { value: "long" } });
    expect(go).toBeEnabled();
    fireEvent.click(go);
    await waitFor(() => expect(onGenerate).toHaveBeenCalledWith({ brief: "How clinics use chatbots", tone: "professional", length: "long", applyIdentity: false, applyImage: false }));
    fireEvent.click(await screen.findByRole("button", { name: /Undo AI changes/ }));
    expect(undo).toHaveBeenCalled();
  });

  it("shows the error and leaves the form alone when the AI call fails", async () => {
    const onGenerate = vi.fn().mockRejectedValue(new Error("boom"));
    render(<AiWriterPanel kind="product" onGenerate={onGenerate} hasContent={false} />);
    fireEvent.click(screen.getByRole("button", { name: /Write with AI/ }));
    fireEvent.change(screen.getByLabelText(/Describe it/), { target: { value: "A chatbot package for shops" } });
    fireEvent.click(screen.getAllByRole("button", { name: /Write with AI/ }).at(-1)!);
    expect(await screen.findByRole("alert")).toHaveTextContent(/not available/);
    expect(screen.queryByRole("button", { name: /Undo/ })).toBeNull();
  });

  it("offers the identity option, honours its default, and pre-fills the brief", async () => {
    const onGenerate = vi.fn().mockResolvedValue(() => {});
    render(<AiWriterPanel kind="product" onGenerate={onGenerate} hasContent identity={{ label: "Also set the name, code and URL slug", hint: "h", defaultChecked: true }} initialBrief="Artify CAS is a construction accounting system" />);
    fireEvent.click(screen.getByRole("button", { name: /Write with AI/ }));
    expect(screen.getByLabelText(/Describe it/)).toHaveValue("Artify CAS is a construction accounting system");
    const box = screen.getByRole("checkbox");
    expect(box).toBeChecked();
    fireEvent.click(screen.getAllByRole("button", { name: /Write with AI/ }).at(-1)!);
    await waitFor(() => expect(onGenerate).toHaveBeenCalledWith(expect.objectContaining({ applyIdentity: true })));
    fireEvent.click(box);
    fireEvent.click(screen.getAllByRole("button", { name: /Write with AI/ }).at(-1)!);
    await waitFor(() => expect(onGenerate).toHaveBeenLastCalledWith(expect.objectContaining({ applyIdentity: false })));
  });

  it("offers the feature image option and passes it through", async () => {
    const onGenerate = vi.fn().mockResolvedValue(() => {});
    render(<AiWriterPanel kind="product" onGenerate={onGenerate} hasContent={false} image={{ label: "Also design a feature image", hint: "h", defaultChecked: true }} />);
    fireEvent.click(screen.getByRole("button", { name: /Write with AI/ }));
    fireEvent.change(screen.getByLabelText(/Describe it/), { target: { value: "A chatbot package for shops" } });
    fireEvent.click(screen.getAllByRole("button", { name: /Write with AI/ }).at(-1)!);
    await waitFor(() => expect(onGenerate).toHaveBeenCalledWith(expect.objectContaining({ applyImage: true })));
    fireEvent.click(screen.getByRole("checkbox", { name: /feature image/i }));
    fireEvent.click(screen.getAllByRole("button", { name: /Write with AI/ }).at(-1)!);
    await waitFor(() => expect(onGenerate).toHaveBeenLastCalledWith(expect.objectContaining({ applyImage: false })));
  });
});
