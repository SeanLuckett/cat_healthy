import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";

export const renderWithProvider = (ui: ReactElement) =>
  render(<MantineProvider>{ui}</MantineProvider>);
