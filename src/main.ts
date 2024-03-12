#!/usr/bin/env bun
import { $, type BunFile } from 'bun';
import path from 'path';
import fs from 'node:fs/promises';
import { Dirent } from 'node:fs';
import { parseArgs } from 'util';
import { v2 as cloudinary, type UploadApiResponse } from 'cloudinary';

type CloudImageInfo = {
  publicId: string;
  url: string;
  originalFilename: string;
  result: UploadApiResponse;
};
/* ./uploaded.jsonと整合性をとること。 */
type UploadedArchive = {
  uploaded: CloudImageInfo[];
};

/* CONFIG AREA */

const xlogDir = '/home/liz/gits/xlog';

cloudinary.config({
  cloud_name: Bun.env.CLOUD_NAME,
  api_key: Bun.env.API_KEY,
  api_secret: Bun.env.API_SECRET,
});

const args = parseArgs({
  args: Bun.argv,
  options: {
    all: {
      type: 'boolean',
      short: 'a',
    },
    gen: {
      type: 'boolean',
      short: 'g',
    },
    original: {
      type: 'boolean',
      short: 'o',
    },
  },
  strict: true,
  allowPositionals: true,
});

/* CONFIG AREA END */

/* ここから 環境設定 */
const uploadDir = path.join(process.cwd(), 'upload');
const postDir = path.join(xlogDir, 'content', 'posts');
const docsDir = path.join(process.cwd(), 'docs');

const publicIdExists = async (publicId: string) => {
  try {
    const uploaded = await loadJsonArchive();
    return uploaded.uploaded.some((image) => image.publicId === publicId);
  } catch (error) {
    console.error('Error checking image:', error);
    throw error;
  }
};

const getDateString = (): string => {
  const date = new Date();
  let year = date.getFullYear();
  let month = date.getMonth() + 1;
  let day = date.getDate();

  let monthFormatted = month < 10 ? `0${month}` : month.toString();
  let dayFormatted = day < 10 ? `0${day}` : day.toString();

  return `${year}${monthFormatted}${dayFormatted}`;
};

const loadJsonArchive = async () => {
  const jsonContent = await Bun.file('./uploaded.json').text();
  const archive: UploadedArchive = JSON.parse(jsonContent);
  return archive;
};

const getImageInfo = async (publicId: string) => {
  const uploaded = await loadJsonArchive();
  return uploaded.uploaded.find((image) => image.publicId === publicId);
};

const pushUploaded = async (imageInfo: CloudImageInfo) => {
  const uploaded = await loadJsonArchive();
  uploaded.uploaded.push(imageInfo);
  const json = JSON.stringify(uploaded, null, 2);
  return await Bun.write('./uploaded.json', json);
};

const uploadImage = async (imagePath: string) => {
  const file: BunFile = Bun.file(imagePath);
  console.log(imagePath.replace(uploadDir, '') + ':', await file.exists());
  const { type } = file.type.split('/').reduce((acc, cur, idx) => {
    if (idx === 0) {
      acc.type = cur;
    } else {
      acc.subtype = cur;
    }
    return acc;
  }, {} as any);

  if (type !== 'image') {
    return undefined;
  }

  const publicId = generatePublicId(imagePath);
  const exists = await publicIdExists(publicId);
  if (exists) {
    console.log('Image already uploaded:', publicId);
    return undefined;
  }

  try {
    const result = await cloudinary.uploader.upload(imagePath, { public_id: publicId });
    console.log('Upload successful:', JSON.stringify(result, null, 2));
    const imageInfo = {
      publicId,
      url: result.secure_url,
      originalFilename: path.basename(imagePath),
      result,
    } as CloudImageInfo;
    await pushUploaded(imageInfo);
    return imageInfo;
  } catch (error) {
    console.error('Error uploading image:', error);
    throw error;
  }
};

const extractDateComponents = (inputString: string): { year: number; month: number; day: number } | undefined => {
  const datePattern = /date\s*=\s*"(\d{4})-(\d{2})-(\d{2})"/;
  const match = inputString.match(datePattern);

  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);

    return { year, month, day };
  } else {
    return undefined;
  }
};

const readPosts = async () => {
  const posts = await fs.readdir(postDir, { withFileTypes: true });
  const buf = [];
  for (const post of posts) {
    if (post.isFile()) {
      const contentLines = (await fs.readFile(path.join(postDir, post.name), 'utf-8')).split('\n');
      for (const line of contentLines) {
        const dateComponents = extractDateComponents(line);
        if (dateComponents) {
          buf.push({ dateComponents, post });
          break;
        }
      }
    }
  }
  return buf;
};

const genDateDirs = async () => {
  const posts = await readPosts();
  const dateDirs = new Set<string>();
  const gitkeeps = new Set<string>();
  for (const { dateComponents } of posts) {
    dateDirs.add(path.join(uploadDir, `${dateComponents.year}`, `${dateComponents.month}`, `${dateComponents.day}`));
    gitkeeps.add(path.join(uploadDir, `${dateComponents.year}`, `${dateComponents.month}`, `${dateComponents.day}`, '.gitkeep'));
  }
  //make dirs
  for (const dir of dateDirs) {
    await fs.mkdir(dir, { recursive: true });
  }
  for (const gitkeep of gitkeeps) {
    await fs.writeFile(gitkeep, '');
  }
};
const getFilePaths = async (dir: string): Promise<string[]> => {
  let dirents = await fs.readdir(dir, { withFileTypes: true });
  let files = await Promise.all(
    dirents.map(async (dirent) => {
      const resPath = path.resolve(dir, dirent.name);
      if (dirent.isDirectory()) {
        return getFilePaths(resPath);
      } else {
        return resPath;
      }
    })
  );

  return files.flat();
};
const trimFilePaths = (filePaths: string[]) => {
  const withoutGitkeep = filePaths.filter((filePath) => !filePath.endsWith('.gitkeep'));
  const trimmed = withoutGitkeep.map((filePath) => filePath.replace(uploadDir, ''));
  return {
    withoutGitkeep,
    trimmed,
  };
};
const generatePublicId = (filePath: string): string => {
  const relativePath = filePath.replace(`${uploadDir}/`, '');
  const withoutExtension = relativePath.replace(path.extname(relativePath), '');
  return withoutExtension;
};

const saveJsonObject = async (obj: any) => {
  const json = JSON.stringify(obj, null, 2);
  const filename = getDateString() + '.json';
  await fs.writeFile(filename, json);
};

const genMarkdown = (htmlString: string) => `## [${getDateString()}]\n\n\`\`\`html\n${htmlString}\n\`\`\``;

const loadTemplate = async () => {
  const template = await Bun.file('./docs/template.md').text();
  return template;
};

const checkDocMarkdown = async (docsFilePath: string, publicId: string) => {
  try {
    const file = Bun.file(docsFilePath);
    const exists = await file.exists();
    if (!exists) {
      const imageInfo = await getImageInfo(publicId);
      if (!imageInfo) {
        throw new Error('Image info not found');
      }
      const docsContent = (await loadTemplate()).replace('IMAGEINFO_IMAGEINFO', JSON.stringify(imageInfo, null, 2));
      await Bun.write(docsFilePath, docsContent);
    } else {
      console.log('File exists:', docsFilePath);
    }
    return true;
  } catch (error) {
    console.error('Error checking doc markdown:', error);
    throw error;
  }
};

const pushContentToDocs = async (content: string, docsFilePath: string, publicId: string) => {
  try {
    const file = Bun.file(docsFilePath);
    const imageInfo = await getImageInfo(publicId);
    if (!imageInfo) {
      throw new Error('Image info not found');
    }

    const bufContent = (await file.text()) + '\n\n';
    const newContent = bufContent + content + '\n' + `### [${new Date().toISOString()}]${imageInfo.originalFilename}||${imageInfo.result.etag}-${publicId}\n\n`;

    await Bun.write(docsFilePath, newContent);
  } catch (error) {
    console.error('Error pushing content to docs:', error);
  }
};

const genOriginUrl = async (publicId: string) => {
  try {
    const imageUrl = cloudinary.url(publicId, {
      // ...options
    });
    console.log('Image URL:', imageUrl);
    const imageInfo = ((await getImageInfo(publicId)) || {}) as CloudImageInfo;
    const { originalFilename } = imageInfo;
    const htmlString = `<img src="${imageUrl}" alt="Cloudinary image<${originalFilename}-${publicId}>" />`;
    const buf = genMarkdown(htmlString);

    const timestampString = getDateString();

    const filePath = path.join(docsDir, timestampString, `${originalFilename}-doc.md`);
    const result = await checkDocMarkdown(filePath, publicId);
    if (result) {
      await pushContentToDocs(buf, filePath, publicId);
    }
    console.log(`File saved as ${filePath}`);
  } catch (error) {
    console.error('Error saving HTML to file:', error);
  }
};

//main
(async () => {
  args.positionals = args.positionals.slice(2);

  if (args.values.all) {
    const filePaths = await getFilePaths(uploadDir);
    const { withoutGitkeep } = trimFilePaths(filePaths);
    const uploadDirFilePaths = withoutGitkeep;
    const results = uploadDirFilePaths.map(async (filePath) => {
      return await uploadImage(filePath);
    });
    const uploadResults = (await Promise.all(results)).filter((result) => result !== undefined);
    await saveJsonObject(uploadResults);
    return;
  } else if (args.values.gen) {
    await genDateDirs();
    return;
  } else if (args.values.original) {
    const archive = await loadJsonArchive();
    const public_ids = archive.uploaded.map((image) => image.publicId);
    for (const public_id of public_ids) {
      await genOriginUrl(public_id);
    }
  }
})();
