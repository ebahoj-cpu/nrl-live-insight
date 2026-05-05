// Public-read server functions for the prediction tracking layer.
// Exposed separately from the main index.functions.ts to keep concerns clear.

import { createServerFn } from "@tanstack/react-start";
import { getModelPerformance, getConfidenceAdjustments, type ModelPerformance, type ConfidenceAdjustments } from "./prediction-tracking";

export const fetchModelPerformance = createServerFn({ method: "GET" })
  .handler(async (): Promise<ModelPerformance> => {
    return getModelPerformance();
  });

export const fetchConfidenceAdjustments = createServerFn({ method: "GET" })
  .handler(async (): Promise<ConfidenceAdjustments> => {
    return getConfidenceAdjustments();
  });
