import axios from 'axios';
import { existsSync, mkdirSync, rmSync, writeFileSync, unlinkSync, readFileSync, readdirSync } from 'fs';
import * as path from 'path';
import * as download from 'download';
import { load } from 'cheerio';
import * as JSZip from 'jszip';
import puppeteer from 'puppeteer';
const ProgressBar = require('progress');

import * as readline from 'readline';

let logs = {} as any;
const timestamp = new Date().toISOString();
const timestamp_convert = timestamp.split(':').slice(0, 2).join('-');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question('Por favor, ingresa un manga (por ejemplo: naruto): ', (answer) => {
  getData(answer);
});

async function getData(name: string) {
  const response = await axios.get(`https://www.leercapitulo.com/search-autocomplete?term=${name}`);

  const data = response.data.map((item: any) => {
    return {
      value: item.value,
      link: 'https://www.leercapitulo.com' + item.link,
    };
  });

  console.log(`Los mangas encontrados de ${name} son: `);
  data.forEach((item: any, index: any) => {
    console.log(`${index + 1}. ${item.value}`);
  });

  rl.question('Ingresa el número del manga que deseas descargar: ', async (mangaIndex) => {
    const mangaName = parseInt(mangaIndex) - 1;
    let manga = data[mangaName].value;
    manga = manga
      .replace(/ /g, '-')
      .replace(/[^\w\s]/gi, '_')

      .replace(/[!?¡¿."]/g, '')
      .replace(/[:,~\s]/g, '_')
      .replace(/[áÁäÄâÂ]/g, 'a')
      .replace(/[éÉëËêÊ]/g, 'e')
      .replace(/[íÍïÏîÎ]/g, 'i')
      .replace(/[óÓöÖôÔ]/g, 'o')
      .replace(/[úÚüÜûÛ]/g, 'u')
      .replace(/\./g, '')
      .replace(/:/g, '')
      .replace(/[\s]/g, '_')
      .replace(/__/g, '_');

    console.log(`El manga seleccionado es:  ${manga}`);
    const mangaPage = data[mangaName].link;
    const mangaResponse = await axios.get(mangaPage);
    const $ = load(mangaResponse.data);
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

    console.log(`El manga ${manga} tiene ${chapters.length} capítulos`);

    for (let j = 0; j < chapters.length; j++) {
      await getImagesPtr(chapters[j], manga, j + 1, chapters_titles[j]);
    }

    rl.close();
  });
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
    const bar = new ProgressBar(`Descargando capítulo ${chapterIndex} [:bar] :percent :etas`, {
      complete: '=',
      incomplete: ' ',
      width: 20,
      total: images.length,
    });

    console.log(`Total de imágenes encontradas para el capítulo ${chapterIndex}: ${images.length} del manga ${mangaTitle}`);

    chapterTitle = chapterTitle
      .replace(/[^\w\s]/gi, '_')
      .replace(/ /g, '_')

      .replace(/[!?¡¿."]/g, '')
      .replace(/[:,~\s]/g, '_')
      .replace(/[áÁäÄâÂ]/g, 'a')
      .replace(/[éÉëËêÊ]/g, 'e')
      .replace(/[íÍïÏîÎ]/g, 'i')
      .replace(/[óÓöÖôÔ]/g, 'o')
      .replace(/[úÚüÜûÛ]/g, 'u')
      .replace(/__/g, '_');

    const chapterFolder = path.join(__dirname, `./mangas/${mangaTitle}/${chapterIndex}_${chapterTitle}`);
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
      const imageFilename = `${i + 1}.jpg`;
      await download(imageUrl, imagePath, { filename: imageFilename });
      bar.tick();
    }

    console.log(`Capítulo ${chapterIndex} descargado del manga ${mangaTitle}`);

    await browser.close();

    await cbzCompress(chapterFolder);
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
  try {
    unlinkSync(`${path}.cbz`);
  } catch (error) {}

  const zipFile = new JSZip();

  const files = readdirSync(path);
  for (const file of files) {
    const filePath = `${path}/${file}`;
    const fileData = readFileSync(filePath);
    zipFile.file(file, fileData);
  }

  const zipData = await zipFile.generateAsync({ type: 'nodebuffer' });

  writeFileSync(`${path}.cbz`, zipData);
  console.log(`Capítulo ${path} comprimido`);

  rmSync(path, { recursive: true });
  console.log(`Carpeta ${path} eliminada`);
}
