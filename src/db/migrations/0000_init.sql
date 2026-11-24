CREATE TABLE "enrichment_cache" (
	"language" text NOT NULL,
	"target_language" text NOT NULL,
	"lookup" text NOT NULL,
	"result" jsonb NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enrichment_cache_language_target_language_lookup_pk" PRIMARY KEY("language","target_language","lookup")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "words" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"word" text NOT NULL,
	"source_form" text,
	"language" text NOT NULL,
	"target_language" text DEFAULT 'en' NOT NULL,
	"part_of_speech" text NOT NULL,
	"gender" text,
	"article" text,
	"plural" text,
	"senses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"source_url" text,
	"enrichment_status" text DEFAULT 'ok' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "words_part_of_speech_check" CHECK ("words"."part_of_speech" in ('noun', 'verb', 'adjective', 'adverb', 'phrase', 'other')),
	CONSTRAINT "words_gender_check" CHECK ("words"."gender" in ('masculine', 'feminine', 'neuter')),
	CONSTRAINT "words_enrichment_status_check" CHECK ("words"."enrichment_status" in ('ok', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "words" ADD CONSTRAINT "words_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "words_user_language_word_unique" ON "words" USING btree ("user_id","language",lower("word"));--> statement-breakpoint
CREATE INDEX "words_user_language_idx" ON "words" USING btree ("user_id","language");