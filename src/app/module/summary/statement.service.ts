import PDFDocument from "pdfkit";
import httpStatus from "http-status";
import type { IRequestUser } from "../auth/auth.interface";
import { requireActiveMembership } from "../mess/mess.scope";
import { assertProAccess } from "../subscription/plan";
import { summaryService } from "./summary.service";
import { AppError } from "../../utils/AppError";

export const createStatementPdf = async (
	user: IRequestUser,
	month?: string,
): Promise<Buffer> => {
	const actor = await requireActiveMembership(user.userId);
	assertProAccess(actor.mess, "PDF statements");
	const summary = await summaryService.getSummary(user, month);

	if (summary.month.status !== "CLOSED") {
		throw new AppError(httpStatus.CONFLICT, "PDF statements are available only for closed months.");
	}

	const member = summary.members.find((item) => item.memberId === actor.id);
	if (!member) {
		throw new AppError(httpStatus.NOT_FOUND, "No statement data found for this member.");
	}

	const document = new PDFDocument({ margin: 48 });
	const chunks: Buffer[] = [];
	document.on("data", (chunk: Buffer) => chunks.push(chunk));
	const completed = new Promise<Buffer>((resolve, reject) => {
		document.on("end", () => resolve(Buffer.concat(chunks)));
		document.on("error", reject);
	});

	document.fontSize(18).text(`${actor.mess.name} - Member Statement`);
	document.moveDown(0.5).fontSize(11).text(`Member: ${member.name}`);
	document.text(`Month: ${summary.month.name}`);
	document.moveDown();
	document.text(`Total meals: ${member.totalMeals}`);
	document.text(`Meal rate: BDT ${summary.totals.mealRate.toFixed(2)}`);
	document.text(`Meal cost: BDT ${member.mealCost.toFixed(2)}`);
	document.text(`Bazar paid: BDT ${member.bazarPaid.toFixed(2)}`);
	document.text(`Meal balance: BDT ${member.mealBalance.toFixed(2)}`);
	document.moveDown();
	document.text("This statement is generated from the closed-month summary.");
	document.end();
	return completed;
};
