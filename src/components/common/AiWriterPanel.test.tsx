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
    await waitFor(() => expect(onGenerate).toHaveBeenCalledWith({ brief: "How clinics use chatbots", tone: "professional", length: "long" }));
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
});
