CREATE TYPE "public"."export_file_type" AS ENUM('transactions', 'inventory', 'sales_summary');--> statement-breakpoint
CREATE TYPE "public"."export_job_status" AS ENUM('pending', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."export_job_trigger" AS ENUM('manual', 'scheduled');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TABLE "export_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"jobId" integer NOT NULL,
	"userId" integer NOT NULL,
	"fileType" "export_file_type" NOT NULL,
	"fileName" varchar(500) NOT NULL,
	"fileUrl" text NOT NULL,
	"fileKey" varchar(500) NOT NULL,
	"fileSizeBytes" bigint DEFAULT 0,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "export_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"status" "export_job_status" DEFAULT 'pending' NOT NULL,
	"triggerType" "export_job_trigger" DEFAULT 'manual' NOT NULL,
	"dateFrom" varchar(10) NOT NULL,
	"dateTo" varchar(10) NOT NULL,
	"storeCount" integer DEFAULT 0,
	"transactionCount" integer DEFAULT 0,
	"inventoryCount" integer DEFAULT 0,
	"errorMessage" text,
	"startedAt" timestamp DEFAULT now() NOT NULL,
	"completedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduler_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"frequencyDays" integer DEFAULT 7 NOT NULL,
	"dayOfWeek" integer DEFAULT 1 NOT NULL,
	"hourOfDay" integer DEFAULT 8 NOT NULL,
	"includeOnline" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "scheduler_config_userId_unique" UNIQUE("userId")
);
--> statement-breakpoint
CREATE TABLE "storehub_credentials" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"username" varchar(255) NOT NULL,
	"apiToken" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"openId" varchar(64) NOT NULL,
	"name" text,
	"email" varchar(320),
	"loginMethod" varchar(64),
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"lastSignedIn" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_openId_unique" UNIQUE("openId")
);
