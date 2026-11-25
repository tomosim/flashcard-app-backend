DROP INDEX "words_user_language_word_unique";--> statement-breakpoint
ALTER TABLE "words" ADD COLUMN "conjugation" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "words_user_language_word_pos_unique" ON "words" USING btree ("user_id","language",lower("word"),"part_of_speech");