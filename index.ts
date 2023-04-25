import axios from 'axios';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import * as path from 'path';
import * as download from 'download';
import { load } from 'cheerio';
import * as semaphore from 'semaphore';
import * as JSZip from 'jszip';
import puppeteer from 'puppeteer';
const ProgressBar = require('progress');

const zip = new JSZip();

const downloaderLimit = semaphore(10);
const downloaderTimer = 2 * 1000;

function getData(url: string) {
  return new Promise((resolve, reject) => {
    downloaderLimit.take(() => {
      axios
        .get(url)
        .then((response) => {
          resolve(response.data);
        })
        .catch((error) => {
          reject(error);
        })
        .finally(() => {
          setTimeout(() => {
            downloaderLimit.leave();
          }, downloaderTimer);
        });
    });
  });
}

const url = 'https://www.leercapitulo.com/';
let logs = {} as any;
const timestamp = new Date().toISOString();
const timestamp_convert = timestamp.split(':').slice(0, 2).join('-');

async function main() {
  const res = await axios.get(url);
  const data = res.data;
  const titles: string[] = data.split('<div class="col-md-6 col-sm-6">');

  for (let i = 1; i < titles.length; i++) {
    let a_title: string = titles[i].split('alt="')[1].split('"')[0];
    const a_url: string = titles[i].split('href="')[1].split('"')[0];

    if (a_title.toLowerCase() === 'one piece') continue;
    const mangaPage = await getData(`https://www.leercapitulo.com${a_url}`);
    const mangaHtml = mangaPage;
    const $ = load(mangaHtml as any, { decodeEntities: false });
    const chapterList = $('.chapter-list');
    const chapters: string[] = chapterList
      .find('a')
      .toArray()
      .map((el) => `https://www.leercapitulo.com${$(el).attr('href')}`);

    const chapters_titles: string[] = chapterList
      .find('a')
      .toArray()
      .map((el) => `${$(el).attr('title')}`);

    chapters.reverse();
    chapters_titles.reverse();

    a_title = a_title
      .replace(/[!?¡¿.]/g, '')
      .replace(/[:,~\s]/g, '_')
      .replace(/[áÁäÄâÂ]/g, 'a')
      .replace(/[éÉëËêÊ]/g, 'e')
      .replace(/[íÍïÏîÎ]/g, 'i')
      .replace(/[óÓöÖôÔ]/g, 'o')
      .replace(/[úÚüÜûÛ]/g, 'u')
      .replace(/[ñÑ]/g, 'n');

    for (let j = 0; j < chapters.length; j++) {
      await getImagesPtr(chapters[j], a_title, j + 1, chapters_titles[j]);
    }
  }
}

async function getImagesPtr(url: string, mangaTitle: string, chapterIndex: number, chapterTitle: string) {
  try {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.goto(url);

    await page.select('.loadImgType', '1');

    await page.waitForSelector('.comic_wraCon.text-center img[data-original]');

    const images = await page.evaluate(() => {
      const imageUrls: string[] = [];

      const imageElements = document.querySelectorAll<HTMLImageElement>('.comic_wraCon.text-center img[data-original]');

      for (const img of imageElements) {
        imageUrls.push(img.getAttribute('data-original')!);
      }

      return imageUrls;
    });
    const bar = new ProgressBar('[:bar] :percent :etas', { total: images.length });
    console.log(images);

    console.log(`Total de imágenes encontradas para el capítulo ${chapterIndex}: ${images.length} del manga ${mangaTitle}`);
    chapterTitle = chapterTitle
      .replace(/[!?¡¿.]/g, '')
      .replace(/[:,~\s]/g, '_')
      .replace(/[áÁäÄâÂ]/g, 'a')
      .replace(/[éÉëËêÊ]/g, 'e')
      .replace(/[íÍïÏîÎ]/g, 'i')
      .replace(/[óÓöÖôÔ]/g, 'o')
      .replace(/[úÚüÜûÛ]/g, 'u');

    const chapterFolder = path.join(__dirname, 'mangas', mangaTitle, `${chapterIndex}-${chapterTitle}`);
    if (!existsSync(chapterFolder)) {
      console.log(`Creando carpeta ${chapterFolder}`);
      mkdirSync(chapterFolder, { recursive: true });

      console.log(`Carpeta ${chapterFolder} creada`);
    } else {
      console.log(`Capítulo ${chapterIndex} ya descargado`);
      return;
    }

    for (let i = 0; i < images.length; i++) {
      const imageUrl = images[i];
      const imagePath = chapterFolder;
      const imageBuffer = await download(imageUrl, imagePath, { filename: `${i + 1}.jpg` });
      console.log(` Imagen ${i + 1} de ${images.length} descargada`);

      zip.file(`${i + 1}.jpg`, imageBuffer);

      bar.tick();
    }

    console.log(`Capítulo ${chapterIndex} descargado  del manga ${mangaTitle}`);

    await cbzCompress(chapterFolder);

    await browser.close();
  } catch (error) {
    console.error(`Error al agregar el capítulo ${chapterTitle}: ${error}`);
    const timestamp_error = new Date().toISOString();
    logs[timestamp_error] = {
      manga: mangaTitle,
      chapter: chapterIndex,
      error: error,
    };
    writeFileSync(`./mangas/error_logs_${timestamp_convert}.json`, JSON.stringify(logs, null, 2));
  }
}

async function cbzCompress(path: string) {
  zip
    .generateAsync({ type: 'nodebuffer' })
    .then((content) => {
      writeFileSync(`${path}.cbz`, content);
      console.log('Imágenes comprimidas en un archivo .cbz');
    })
    .catch((error) => {
      console.error('Error al comprimir las imágenes:', error);
    });
}

main();
