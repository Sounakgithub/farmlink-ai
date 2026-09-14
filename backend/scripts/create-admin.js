/**
 * Create or promote a FarmLink administrator.
 *
 * Admin accounts cannot be created through the public sign-up form, on
 * purpose. Run this on the server instead:
 *
 *   npm run create-admin -- --email ops@example.com --name "Ops Lead" --password "a-long-password"
 *   npm run create-admin -- --email existing@example.com --promote
 *
 * --promote turns an existing account into an admin (its old role's data is
 * left in place but it will see the admin console from then on).
 */

require("dotenv").config();
const bcrypt = require("bcrypt");
const mongoose = require("mongoose");
const User = require("../models/User");

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : true;
}

async function main() {
  const email = typeof arg("email") === "string" ? arg("email").toLowerCase().trim() : "";
  const name = typeof arg("name") === "string" ? arg("name").trim() : "";
  const password = typeof arg("password") === "string" ? arg("password") : "";
  const promote = arg("promote") === true;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Pass a valid --email.");
  }
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is not set. Copy .env.example to .env first.");
  }

  await mongoose.connect(process.env.MONGO_URI);
  const existing = await User.findOne({ email });

  if (promote) {
    if (!existing) throw new Error(`No account with email ${email}.`);
    const previousRole = existing.role;
    existing.role = "admin";
    await existing.save();
    console.log(`Promoted ${email} from ${previousRole} to admin.`);
    return;
  }

  if (existing) {
    throw new Error(`${email} already exists. Use --promote to make it an admin.`);
  }
  if (!name) throw new Error("Pass --name for a new admin.");
  if (password.length < 12) throw new Error("Admin passwords must be at least 12 characters.");

  await User.create({
    name,
    email,
    password: await bcrypt.hash(password, 10),
    role: "admin",
  });
  console.log(`Created admin ${email}. Sign in through the normal login page.`);
}

main()
  .catch((error) => {
    console.error(`create-admin: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
