/*
  Warnings:

  - You are about to drop the `locations` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `locationId` on the `assets` table. All the data in the column will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "locations";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_assets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "uom" TEXT NOT NULL,
    "uoo" TEXT NOT NULL,
    "conversionFactor" DECIMAL NOT NULL DEFAULT 1,
    "formula" TEXT,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "assets_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_assets" ("archivedAt", "categoryId", "conversionFactor", "createdAt", "description", "formula", "id", "name", "type", "uom", "uoo", "updatedAt") SELECT "archivedAt", "categoryId", "conversionFactor", "createdAt", "description", "formula", "id", "name", "type", "uom", "uoo", "updatedAt" FROM "assets";
DROP TABLE "assets";
ALTER TABLE "new_assets" RENAME TO "assets";
CREATE UNIQUE INDEX "assets_name_key" ON "assets"("name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
