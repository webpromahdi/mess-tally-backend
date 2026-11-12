import type { adminService } from "./admin.service";

/** Response shapes, derived from the service so they can't drift. */
export type TAdminOverview = Awaited<
	ReturnType<typeof adminService.getOverview>
>;
export type TAdminUser = Awaited<
	ReturnType<typeof adminService.listUsers>
>["users"][number];
export type TAdminMess = Awaited<
	ReturnType<typeof adminService.listMesses>
>["messes"][number];
export type TAdminRevenue = Awaited<ReturnType<typeof adminService.getRevenue>>;
