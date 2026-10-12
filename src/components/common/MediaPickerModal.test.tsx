/** The featured-image picker can upload a new image directly and attach it, only for users with media.upload. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MediaPickerModal } from "./MediaPickerModal";

const listMock = vi.fn();
const uploadMock = vi.fn();
const notifyMock = vi.fn();
let permissions: string[] = ["media.read", "media.upload"];

vi.mock("../../lib/api", () => ({
  mediaApi: {
    list: (...a: unknown[]) => listMock(...a),
    getReadUrl: vi.fn().mockResolvedValue({ url: "https://cdn.example/x.png" }),
    uploadFile: (...a: unknown[]) => uploadMock(...a),
  },
}));
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: { role: { permissions } } }) }));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ notify: notifyMock }) }));

const media = { id: "m-1", originalFilename: "banner.png", displayName: null, altText: null, mimeType: "image/png", status: "ACTIVE" };

afterEach(() => {
  cleanup();
  listMock.mockReset();
  uploadMock.mockReset();
  notifyMock.mockReset();
  permissions = ["media.read", "media.upload"];
});

const setup = () => {
  listMock.mockResolvedValue({ items: [], page: 1, limit: 24, total: 0, totalPages: 1 });
  const onSelect = vi.fn();
  render(<MediaPickerModal open onClose={() => undefined} onSelect={onSelect} />);
  return onSelect;
};

describe("MediaPickerModal upload", () => {
  it("uploads a chosen image and attaches it immediately", async () => {
    uploadMock.mockResolvedValue(media);
    const onSelect = setup();
    const input = (await screen.findByLabelText("Upload image file")) as HTMLInputElement;
    const file = new File([new Uint8Array(10)], "banner.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(uploadMock).toHaveBeenCalledWith(file, { mimeType: "image/png" }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(media));
  });

  it("rejects non-image files and files over 10 MB without uploading", async () => {
    const onSelect = setup();
    const input = (await screen.findByLabelText("Upload image file")) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "doc.pdf", { type: "application/pdf" })] } });
    expect(notifyMock).toHaveBeenCalledWith(expect.stringMatching(/JPG, PNG/), "error");
    const big = new File([new Uint8Array(11 * 1024 * 1024)], "big.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [big] } });
    expect(notifyMock).toHaveBeenCalledWith(expect.stringMatching(/10 MB/), "error");
    expect(uploadMock).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("shows an error and does not attach when the upload fails", async () => {
    uploadMock.mockRejectedValue(new Error("boom"));
    const onSelect = setup();
    const input = (await screen.findByLabelText("Upload image file")) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "a.png", { type: "image/png" })] } });
    await waitFor(() => expect(notifyMock).toHaveBeenCalledWith("Could not upload the image.", "error"));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("hides the upload button without media.upload", async () => {
    permissions = ["media.read"];
    setup();
    await screen.findByText("No images found");
    expect(screen.queryByLabelText("Upload image file")).toBeNull();
    expect(screen.queryByRole("button", { name: /upload image/i })).toBeNull();
  });
});
