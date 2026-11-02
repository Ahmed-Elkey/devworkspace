// Vercel function entry. The built API lives in ../apps/api/dist (produced by
// the project build command). This thin re-export keeps Vercel's automatic
// function detection (rootDirectory/api/*) pointed at the compiled handler,
// leaving all backend sources untouched.
import handler from '../apps/api/dist/serverless.js';

export default handler;
