declare module "@vercel/analytics/react" {
  import * as React from "react";

  export interface AnalyticsProps {
    mode?: "production" | "development";
    debug?: boolean;
    beforeSend?: (event: Record<string, unknown>) => Record<string, unknown> | null;
  }

  export const Analytics: React.ComponentType<AnalyticsProps>;
}
