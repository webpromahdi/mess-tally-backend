import httpStatus from "http-status";
import OpenAI from "openai";
import type {
	ChatCompletionMessage,
	ChatCompletionMessageParam,
	ChatCompletionMessageToolCall,
} from "openai/resources/chat/completions";
import config from "../../config";
import { redisClient } from "../../lib/redis";
import { AppError } from "../../utils/AppError";
import { todayDateOnly } from "../../utils/time";
import type { IRequestUser } from "../auth/auth.interface";
import { aiTools } from "./ai.tools";
import type { TChatPayload } from "./ai.validation";

// Fail fast on boot instead of on the first chat request.
if (!config.ai_api_key) {
	throw new Error("AI_API_KEY is missing in .env");
}

const client = new OpenAI({
	apiKey: config.ai_api_key,
	baseURL: config.ai_base_url,
	timeout: 30_000,
	maxRetries: 1,
});

const MAX_ROUNDS = 5;
const MAX_HISTORY = 6;
const RATE_LIMIT_PER_MINUTE = 20;

const toolsByName = new Map(
	aiTools.map((t) => [t.definition.function.name, t]),
);
const toolDefinitions = aiTools.map((t) => t.definition);

const systemPrompt = (user: IRequestUser) =>
	[
		"You are TallyBot, the assistant inside MessTally, a shared-mess meal and expense tracker.",
		`The user is ${user.name}. Today is ${todayDateOnly(config.app_timezone)}. Money is in BDT (৳).`,
		"Always get numbers from tools; never guess or calculate figures yourself. Call several tools if a question needs them.",
		"Meal accounting (meals, bazar, meal rate) and utility accounting (bills, utility deposits, fund) are separate; never mix them.",
		"If a tool returns an error, explain it plainly. You can only read data; never claim you added, changed or deleted anything.",
		"Reply briefly in the user's language (English or Banglish), as plain text: no markdown, tables or headings.",
	].join("\n");

const rateLimit = async (userId: string) => {
	const key = `ai:rate:${userId}`;
	const count = await redisClient.incr(key);

	if (count === 1) {
		await redisClient.expire(key, 60);
	}

	if (count > RATE_LIMIT_PER_MINUTE) {
		throw new AppError(
			httpStatus.TOO_MANY_REQUESTS,
			"Too many TallyBot messages. Please wait a minute.",
		);
	}
};

const callModel = async (
	messages: ChatCompletionMessageParam[],
	allowTools: boolean,
): Promise<ChatCompletionMessage> => {
	try {
		const completion = await client.chat.completions.create({
			model: config.ai_model,
			messages,
			tools: toolDefinitions,
			tool_choice: allowTools ? "auto" : "none",
		});
		const message = completion.choices[0]?.message;

		if (!message) {
			throw new AppError(httpStatus.BAD_GATEWAY, "TallyBot returned no reply.");
		}

		return message;
	} catch (error) {
		if (error instanceof OpenAI.RateLimitError) {
			throw new AppError(
				httpStatus.SERVICE_UNAVAILABLE,
				"TallyBot is busy right now. Please try again shortly.",
			);
		}

		if (error instanceof OpenAI.APIError) {
			// Clients get a generic message; the real provider reason stays in the log.
			console.error("[ai] provider error", error.status, error.message);
			throw new AppError(
				httpStatus.BAD_GATEWAY,
				"TallyBot is unavailable right now. Please try again.",
			);
		}

		throw error;
	}
};

const runTool = async (
	user: IRequestUser,
	call: ChatCompletionMessageToolCall,
): Promise<unknown> => {
	const tool =
		call.type === "function" ? toolsByName.get(call.function.name) : undefined;

	if (!tool || call.type !== "function") {
		return { error: "Unknown tool." };
	}

	try {
		return await tool.execute(
			user,
			JSON.parse(call.function.arguments || "{}"),
		);
	} catch (error) {
		// Handled failures (no active mess, manager only, PRO only, bad JSON) go
		// back to the model so it can explain them; anything else is a real 500.
		if (error instanceof AppError || error instanceof SyntaxError) {
			return { error: error.message };
		}

		throw error;
	}
};

const chat = async (
	user: IRequestUser,
	messages: TChatPayload["messages"],
): Promise<{ reply: string; proposals: [] }> => {
	await rateLimit(user.userId);

	const history: ChatCompletionMessageParam[] = [
		{ role: "system", content: systemPrompt(user) },
		...messages.slice(-MAX_HISTORY),
	];

	for (let round = 1; ; round++) {
		// The last round forbids tools so the loop always ends with text.
		const message = await callModel(history, round < MAX_ROUNDS);

		if (!message.tool_calls?.length) {
			return { reply: message.content ?? "", proposals: [] };
		}

		// Only standard fields: reasoning models (gpt-oss) add a `reasoning`
		// field that Groq rejects when it is sent back.
		history.push({
			role: "assistant",
			content: message.content,
			tool_calls: message.tool_calls,
		});

		for (const call of message.tool_calls) {
			history.push({
				role: "tool",
				tool_call_id: call.id,
				content: JSON.stringify(await runTool(user, call)),
			});
		}
	}
};

export const aiService = {
	chat,
};
