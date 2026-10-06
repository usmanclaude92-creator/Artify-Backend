import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SocialOverviewPage } from "./SocialOverviewPage";

describe("SocialOverviewPage", () => {
  it("shows the coming-soon empty state", () => {
    render(<SocialOverviewPage />);
    expect(screen.getByText(/coming in the next phase/i)).toBeInTheDocument();
  });
});
