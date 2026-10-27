import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const BUCKET = "clips";
const LABELS = ["locked-in", "brain-rot"];

const s3 = new S3Client({ forcePathStyle: true });

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

export async function POST(req: Request) {
  const { name, label, contentType, ext } = await req.json();

  const user = slug(String(name ?? ""));
  if (!user) return Response.json({ error: "name required" }, { status: 400 });
  if (!LABELS.includes(label)) return Response.json({ error: "bad label" }, { status: 400 });
  if (!["webm", "mp4"].includes(ext)) return Response.json({ error: "bad ext" }, { status: 400 });

  const key = `${user}/${new Date().toISOString().replace(/[:.]/g, "-")}_${label}.${ext}`;
  const url = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType }),
    { expiresIn: 300 },
  );

  return Response.json({ url, key });
}
