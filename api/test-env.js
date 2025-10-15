export default function handler(req, res) {
  res.status(200).json({
    secret_seen_by_server: process.env.STUDENT_SECRET || "missing",
    owner_seen_by_server: process.env.GH_OWNER || "missing"
  });
}
