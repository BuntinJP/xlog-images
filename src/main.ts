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
  result: UploadApiResponse | any;
};
/* ./uploaded.jsonと整合性をとること。 */
type UploadedArchive = {
  uploaded: CloudImageInfo[];
  destroyed: CloudImageInfo[];
};
type DateComponents = {
  year: string;
  month: string;
  day: string;
};

/* CONFIG AREA */

const xlogDir = '/Users/takumi.aoki/gits/xlog';

/* CONFIG AREA END */

/* ここから 環境設定 */
const uploadDir = path.join(process.cwd(), 'upload');
const postDir = path.join(xlogDir, 'content');
const docsDir = path.join(process.cwd(), 'docs');
const htmlDir = path.join(process.cwd(), 'html');
const backupDir = path.join(process.cwd(), 'backup');
const archiveDir = path.join(process.cwd(), 'archive');

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
    delete: {
      type: 'boolean',
      short: 'd',
    },
    test: {
      type: 'boolean',
      short: 't',
    },
    refresh: {
      type: 'boolean',
      short: 'r',
    },
    help: {
      type: 'boolean',
      short: 'h',
    },
  },
  strict: true,
  allowPositionals: true,
});

const publicIdExists = async (publicId: string) => {
  try {
    const uploaded = await getCloudAssets();
    console.log('Uploaded:', JSON.stringify(uploaded, null, 2));
    return uploaded.some((image) => image.publicId === publicId);
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
    const result = await cloudinary.uploader.upload(imagePath, {
      public_id: publicId,
    });
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

const extractDateComponents = (inputStrings: string[]): DateComponents | undefined => {
  const datePattern = /date:\s*(\d{4})-(\d{2})-(\d{2})/;
  for (const inputString of inputStrings) {
    const match = inputString.match(datePattern);
    if (match) {
      const year = match[1];
      const month = match[2];
      const day = match[3];
      return { year, month, day };
    }
  }
  return undefined;
};

const genDateDirs = async (directoryPath: string): Promise<string> => {
  try {
    const files = await fs.readdir(directoryPath, { withFileTypes: true });
    const dateComponentsList: DateComponents[] = [];

    for (const file of files) {
      if (file.isFile() && file.name.endsWith('.mdx')) {
        const filePath = path.join(directoryPath, file.name);
        const contentLines = (await fs.readFile(filePath, 'utf-8')).split('\n');
        const dateComponents = extractDateComponents(contentLines);
        if (dateComponents !== undefined) {
          dateComponentsList.push(dateComponents);
        }
      }
    }
    const dateComponentsAry = dateComponentsList.sort((a: DateComponents, b: DateComponents) => {
      const aDate = parseInt(`${a.year}${a.month}${a.day}`);
      const bDate = parseInt(`${b.year}${b.month}${b.day}`);
      return aDate - bDate;
    });
    const dateDirs = new Set<string>();
    const gitkeeps = new Set<string>();
    for (const dateComponents of dateComponentsAry) {
      const dateDirPath = path.join(uploadDir, `${dateComponents.year}`, `${dateComponents.month}`, `${dateComponents.day}`);
      const gitkeepPath = path.join(dateDirPath, '.gitkeep');
      dateDirs.add(dateDirPath);
      gitkeeps.add(gitkeepPath);
    }
    //make dirs
    for (const dir of dateDirs) {
      await fs.mkdir(dir, { recursive: true });
    }
    for (const gitkeep of gitkeeps) {
      await fs.writeFile(gitkeep, '');
    }
    return 'complete';
  } catch (e) {
    return (e as any).message ?? 'error';
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
  await fs.writeFile(path.join(archiveDir, filename), json);
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
    }
    return true;
  } catch (error) {
    console.error('Error checking doc markdown:', error);
    throw error;
  }
};

const pushContentToDocs = async (content: string, docsFilePath: string, htmlFilePath: string, publicId: string) => {
  try {
    const file = Bun.file(docsFilePath);
    const imageInfo = await getImageInfo(publicId);
    if (!imageInfo) {
      throw new Error('Image info not found');
    }

    const bufContent = (await file.text()) + '\n\n';
    const mdContent = genMarkdown(content);
    const newContent = bufContent + mdContent + '\n' + '---';

    const fileContent = newContent.replace('IMAGE_HTML_TAG', content);

    await Bun.write(docsFilePath, fileContent);
    await Bun.write(htmlFilePath, content);
  } catch (error) {
    console.error('Error pushing content to docs:', error);
  }
};

// '2024/2/2/???(filename)' 形式の文字列から 'filename-YYYYMMDD' を生成する関数
const formatPublicId = (publicId: string): string => {
  const match = publicId.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})\/(.+)$/);
  if (!match) {
    throw new Error('Invalid publicId format');
  }

  const [, year, month, day, filename] = match; //map[""]

  return `${filename}-${year}${month}${day}`;
};

const genOriginUrl = async (publicId: string) => {
  try {
    const imageUrl = cloudinary.url(publicId, {
      // ...options
    });
    console.log('Image URL:', imageUrl);
    const imageInfo = ((await getImageInfo(publicId)) || {}) as CloudImageInfo;
    const { originalFilename } = imageInfo;
    const htmlString = `<img src="${imageUrl}" alt="image hosted by Cloudinary<${originalFilename}-${publicId}>" />`;
    const buf = htmlString;

    const timestampString = getDateString();

    const docsFilePath = path.join(docsDir, 'target', `${formatPublicId(publicId)}-doc.md`);
    const htmlFilePath = path.join(htmlDir, 'target', `${formatPublicId(publicId)}.html`);

    const result = await checkDocMarkdown(docsFilePath, publicId);
    if (result) {
      await pushContentToDocs(buf, docsFilePath, htmlFilePath, publicId);
    }
    console.log(`File saved as ${docsFilePath}`);
  } catch (error) {
    console.error('Error saving HTML to file:', error);
  }
};

const deleteCloudAsset = async (publicId: string) => {
  try {
    const result = await cloudinary.uploader.destroy(publicId);
    const imageInfo = await getImageInfo(publicId);
    if (!imageInfo) {
      throw new Error('Image info not found');
    }
    const archive = await loadJsonArchive();
    archive.destroyed.push(imageInfo);
    //rm from archive.uploaded
    archive.uploaded = archive.uploaded.filter((image) => image.publicId !== publicId);
    const json = JSON.stringify(archive, null, 2);
    await Bun.write('./uploaded.json', json);
    return result;
  } catch (error) {
    console.error('Error deleting asset:', error);
  }
};

const getCloudAssets = async (): Promise<CloudImageInfo[]> => {
  try {
    const result = await cloudinary.api.resources({
      type: 'upload', // 'upload'タイプのリソースのみを取得
      max_results: 500, // 最大取得数（1〜500の範囲で指定可能）
    });

    const imageInfos: CloudImageInfo[] = result.resources
      .map((asset: any) => ({
        publicId: asset.public_id,
        url: asset.secure_url,
        originalFilename: asset.original_filename,
        result: asset,
      }))
      .filter((imageInfo: any) => {
        return !imageInfo.publicId.includes('samples/');
      });

    return imageInfos;
  } catch (error) {
    console.error('Error fetching uploaded assets info:', error);
    throw error;
  }
};

const refreshArchive = async () => {
  const filePaths = await getFilePaths(uploadDir);
  const { withoutGitkeep } = trimFilePaths(filePaths);
  const uploadDirFilePaths = withoutGitkeep;
  const nowArchive = await loadJsonArchive();
  const _backupArchive = await Bun.write(path.join(backupDir, `${getDateString()}.json`), JSON.stringify(nowArchive, null, 2));

  const { uploaded, destroyed } = nowArchive;
  const newDestroyed = destroyed.filter((image) => {
    return uploaded.some((uploadedImage) => uploadedImage.publicId === image.publicId);
  });
  const res = await Bun.write(
    './uploaded.json',
    JSON.stringify(
      {
        uploaded,
        destroyed: newDestroyed,
      } as UploadedArchive,
      null,
      2
    )
  );
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
    console.log(await genDateDirs(postDir));
    return;
  } else if (args.values.original) {
    const archive = await loadJsonArchive();
    const public_ids = archive.uploaded.map((image) => image.publicId);
    for (const public_id of public_ids) {
      await genOriginUrl(public_id);
    }
    return;
  } else if (args.values.delete) {
    //
    const archive = await loadJsonArchive();
    const public_ids = archive.uploaded.map((image) => image.publicId);
    for (const public_id of public_ids) {
      console.log('Deleting:', public_id);
      await Bun.sleep(200);
      await deleteCloudAsset(public_id);
    }
    return;
  } else if (args.values.help) {
    console.log('Help');
    console.log('[bun run all] option: -a, --all', 'Upload all images in upload directory');
    console.log('[bun run gen] option: -g, --gen', 'Generate date directories');
    console.log('[bun run original] option: -o, --original', 'Generate original image URLs');
    console.log('[bun run delete] option: -d, --delete', 'Delete all images');
    console.log('[bun run test] option: -t, --test', 'Test');
    console.log('[bun run refresh] option: -r, --refresh', 'Refresh archive');
    console.log('[bun run help] option: -h, --help', 'Show help');
    return;
  } else if (args.values.test) {
    console.log('Test');
    console.log('refreshArchive');
    await refreshArchive();
    console.log('getCloudAssets');
    const assets = await getCloudAssets();
    console.log('assets:', JSON.stringify(assets, null, 2));
    return;
  } else if (args.values.refresh) {
    await refreshArchive();
    return;
  }
})();
