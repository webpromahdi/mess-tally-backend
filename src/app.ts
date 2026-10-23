import cookieParser from "cookie-parser";
import cors from "cors";
import express, {
	type Application,
	type Request,
	type Response,
} from "express";
import httpStatus from "http-status";
import config from "./app/config";
import { globalErrorHandler } from "./app/middleware/globalErrorHandler";
import { notFound } from "./app/middleware/notFound";
import { AuthRoutes } from "./app/module/auth/auth.route";
import { bazarRoutes } from "./app/module/bazar/bazar.route";
import { dashboardRoutes } from "./app/module/dashboard/dashboard.route";
import { depositRoutes } from "./app/module/deposit/deposit.route";
import { mealRoutes } from "./app/module/meal/meal.route";
import { messRoutes } from "./app/module/mess/mess.route";
import { messMemberRoutes } from "./app/module/messMember/member.route";
import { monthRoutes } from "./app/module/messMonth/month.route";
import { ProfileRoute } from "./app/module/profile/profile.route";
import { summaryRoutes } from "./app/module/summary/summary.route";
import { utilityRoutes } from "./app/module/utility/utility.route";

const app: Application = express();

app.use(
	cors({
		origin: config.frontend_url,
		credentials: true,
	}),
);

// Enable URL-encoded form data parsing
app.use(express.urlencoded({ extended: true }));

// Middleware to parse JSON bodies
app.use(express.json());
app.use(cookieParser());

app.use("/api/v1/auth", AuthRoutes);
app.use("/api/v1/mess", messRoutes);
app.use("/api/v1/mess", messMemberRoutes);
app.use("/api/v1/months", monthRoutes);
app.use("/api/v1/meals", mealRoutes);
app.use("/api/v1/bazar", bazarRoutes);
app.use("/api/v1/utilities/fund-deposits", depositRoutes);
app.use("/api/v1/utilities", utilityRoutes);
app.use("/api/v1/summary", summaryRoutes);
app.use("/api/v1/dashboard", dashboardRoutes);
app.use("/api/v1/profile", ProfileRoute);

// Basic route
app.get("/", async (req: Request, res: Response) => {
	res.status(httpStatus.OK).json({
		success: true,
		message: "Welcome to MessTally",
	});
});

app.use(notFound);
app.use(globalErrorHandler);

export default app;
