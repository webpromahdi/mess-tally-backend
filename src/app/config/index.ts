import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(process.cwd(), ".env") });

export default {
	node_env: process.env.NODE_ENV!,
	port: process.env.PORT!,
	database_url: process.env.DATABASE_URL!,
	bak_url: process.env.APP_URL!,
	frontend_url: process.env.FRONTEND_URL!,
	bcrypt_salt_rounds: process.env.BCRYPT_SALT_ROUNDS!,
	jwt_access_secret: process.env.JWT_ACCESS_SECRET!,
	jwt_refresh_secret: process.env.JWT_REFRESH_SECRET!,
	jwt_access_expires_in: process.env.JWT_ACCESS_EXPIRES_IN!,
	jwt_refresh_expires_in: process.env.JWT_REFRESH_EXPIRES_IN!,
	redis_user: process.env.REDIS_USER!,
	redis_password: process.env.REDIS_PASSWORD!,
	redis_host: process.env.REDIS_HOST!,
	redis_port: process.env.REDIS_PORT!,
	smtp_user: process.env.SMTP_USER!,
	smtp_password: process.env.SMTP_PASSWORD!,
	email_sender: process.env.EMAIL_SENDER!,
	cloudinary_cloud_name: process.env.CLOUDINARY_CLOUD_NAME!,
	cloudinary_api_key: process.env.CLOUDINARY_API_KEY!,
	cloudinary_api_secret: process.env.CLOUDINARY_API_SECRET!,
	bkash_base_url: process.env.BKASH_BASE_URL!,
	bkash_username: process.env.BKASH_USERNAME!,
	bkash_password: process.env.BKASH_PASSWORD!,
	bkash_app_key: process.env.BKASH_APP_KEY!,
	bkash_app_secret: process.env.BKASH_APP_SECRET!,
	bkash_callback_url: process.env.BKASH_CALLBACK_URL!,
	bkash_merchant_association_info:
		process.env.BKASH_MERCHANT_ASSOCIATION_INFO || "",

	// PRO subscription prices in BDT.
	pro_price_1_month: Number(process.env.PRO_PRICE_1_MONTH || "100"),
	pro_price_6_month: Number(process.env.PRO_PRICE_6_MONTH || "500"),
	pro_price_12_month: Number(process.env.PRO_PRICE_12_MONTH || "1000"),

	// Timezone used for today/cutoff and the "current month" archive gate.
	app_timezone: process.env.APP_TIMEZONE || "Asia/Dhaka",

	// Frontend page bKash redirects back to after the callback.
	frontend_billing_path: process.env.FRONTEND_BILLING_PATH || "/settings/billing",
};
