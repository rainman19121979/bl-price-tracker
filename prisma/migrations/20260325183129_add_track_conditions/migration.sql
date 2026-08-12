-- AlterTable
ALTER TABLE "user_watchlists" ADD COLUMN     "track_new" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "track_used" BOOLEAN NOT NULL DEFAULT false;
