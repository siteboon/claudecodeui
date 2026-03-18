import { userDb } from "@/shared/database/repositories/users.js";

console.log("----------------Hello there, Refactored Runner!-------------------");

console.log("User db initialized");
console.log("First user:", userDb.getFirstUser());
