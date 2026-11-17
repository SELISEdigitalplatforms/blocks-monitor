/** The 3D factory floor, loaded lazily with a retry on a failed chunk (a network drop or a redeploy); one definition for Home,
 *  the dashboard and the build page. */
import { lazy } from "react";
import { retryImport } from "@/components/office/retry";

export const FactoryOffice = lazy(() => retryImport(() => import("@/components/office/FactoryOffice")).then((m) => ({ default: m.FactoryOffice })));
