/* eslint-env node, browser */

let config = {
	minContrast: 5.0,
	constrastStepChange: 0.25, // How quickly to change background and foreground colors when fixing contrast,
	lightMode: false,
	updateSpeedLimit: 100, // Minimum ms allowed between each update of the music list. Higher means songs update in larger groups.
	maxMusicSearchDepth: 10, // Max search depth of folders in music added
}

import * as fs from 'fs' // .promises
import * as os from 'os'
import * as url from 'url'
import * as path from 'path'
import Color from 'color'
import * as mm from 'music-metadata'
import * as Vibrant from 'node-vibrant'

function forceElementById<T extends HTMLElement>(
	elid: string,
	type: { new (): T },
) {
	const el = document.getElementById(elid)
	if (!el) {
		alert(`The element ${el} does not exist`)
		throw new Error('!el')
	}
	if (!(el instanceof type)) {
		alert(`The element ${el} #${elid} was not of the expected type ${type}`)
		throw new Error('!el instanceof type')
	}
	return el
}

let elAudio = forceElementById('nowplaying_audio', HTMLAudioElement)
let elSkip = forceElementById('skip', HTMLButtonElement)
let elPrevious = forceElementById('previous', HTMLButtonElement)
let elSonglist = forceElementById('songlist', HTMLUListElement)
let elSearch = forceElementById('search', HTMLInputElement)
let elPlaypause = forceElementById('playpause', HTMLButtonElement)

if (
	!elAudio ||
	!elSkip ||
	!elPrevious ||
	!elSonglist ||
	!elSearch ||
	!elPlaypause
) {
	alert('An element was missing during initialization.')
	throw new Error('An element was missing during initialization.')
}

if (!(elAudio instanceof HTMLAudioElement)) {
	alert('Audio element was incorrect during initialization.')
	throw new Error(
		'Audio element element was incorrect during initialization.',
	)
}

type MusicData = { filename: string; path: string; uuid: Symbol; tags: any }

let history: MusicData[] = []

elPlaypause.addEventListener('click', (e /*: MouseEvent*/) => {
	e.preventDefault()
	playpause()
})

function playpause(value?: boolean): void {
	if (value === undefined) {
		return playpause(elAudio.paused)
	}
	if (value) {
		elAudio.play()
		elPlaypause.classList.add('play')
	} else {
		elAudio.pause()
		elPlaypause.classList.remove('play')
	}
}

let currentlyPlaying: string
let music: MusicData[] = []

function addMusic(musicPath: string, depth = 1): void {
	if (depth > config.maxMusicSearchDepth) {
		return
	} //workaround for circular symlinks
	let lstat = fs.statSync(musicPath)
	console.log(lstat.isDirectory())
	if (lstat.isDirectory()) {
		return fs
			.readdirSync(musicPath)
			.forEach(subPath =>
				addMusic(path.join(musicPath, subPath), depth + 1),
			)
	}
	let song = {
		filename: path.basename(musicPath),
		path: musicPath,
		uuid: Symbol(musicPath),
		tags: undefined,
	}
	music.push(song)
}

let playlistFilter = (song: MusicData) => {
	let searchdata = song.filename
	if (song.tags) {
		searchdata += ` ${song.tags.title} ${song.tags.author} ${song.tags.album}`
	}
	searchdata = searchdata.toLowerCase()

	let searchTerm = elSearch.value.toLowerCase()
	return searchTerm
		.split(' ')
		.every(i =>
			searchdata.indexOf(i) > -1
				? ((searchdata = searchdata.replace(i, '')), true)
				: false,
		)
}

let lastList = 0
let llTimeout: NodeJS.Timeout

function createLoadingSpinner() {
	let el = document.createElement('span')
	// el.classList.add("loading");
	el.innerText = '... '
	return el
}

function listMusic() {
	if (new Date().getTime() - config.updateSpeedLimit < lastList) {
		llTimeout && clearTimeout(llTimeout)
		llTimeout = setTimeout(listMusic, config.updateSpeedLimit)
		return
	}
	let newList = document.createElement('ul')
	newList.setAttribute('id', 'songlist')
	let loadCount = 0
	music.forEach(song => {
		if (!playlistFilter(song)) {
			return
		}
		let li = document.createElement('li')
		if (!song.tags) {
			li.appendChild(createLoadingSpinner())
			loadCount++
		}
		if (song.tags && song.tags.art) {
			let icon = document.createElement('img')
			icon.src = song.tags.art
			icon.classList.add('icon')
			li.appendChild(icon)
		}
		let title = document.createElement('span')
		li.addEventListener('click', (e /*: MouseEvent*/) => {
			e.preventDefault()
			playSong(song)
		})
		li.setAttribute('role', 'button')
		li.setAttribute('aria-pressed', 'false')
		li.setAttribute('tabindex', '0')
		if (song.tags && song.tags.title && song.tags.artist) {
			title.innerText = `${song.tags.title} by ${song.tags.artist}`
		} else {
			title.innerText = `${song.filename}`
		}
		li.appendChild(title)
		if (currentlyPlaying === song.path) {
			li.classList.add('playing')
			li.setAttribute('aria-pressed', 'true')
		}
		if (song.tags && song.tags.color) {
			if (config.lightMode) {
				li.style.setProperty(
					'--track-foreground',
					song.tags.color.dark.hex(),
				)
				li.style.setProperty(
					'--track-background',
					song.tags.color.light.hex(),
				)
			} else {
				li.style.setProperty(
					'--track-foreground',
					song.tags.color.light.hex(),
				)
				li.style.setProperty(
					'--track-background',
					song.tags.color.dark.hex(),
				)
			}
		}
		newList.appendChild(li)
	})
	elSonglist.parentNode &&
		elSonglist.parentNode.replaceChild(newList, elSonglist)
	elSonglist = newList
	lastList = new Date().getTime()

	if (loadCount > 0) {
		let li = document.createElement('li')
		li.appendChild(createLoadingSpinner())
		li.innerText = `Loading ${loadCount} more songs...`
		newList.appendChild(li)
	}
}
elSearch.addEventListener('input', listMusic)

async function readTags(filename: string) {
	let songTags = (await mm.parseFile(filename, {})).common
	if (songTags.picture && songTags.picture[0]) {
		songTags.art = `data:${
			songTags.picture[0].format
		};base64,${songTags.picture[0].data.toString('base64')}`
		songTags.artBuffer = songTags.picture[0].data
		songTags.vibrant = Vibrant.from(songTags.artBuffer)
		songTags.swatches = await songTags.vibrant.getSwatches()

		let dark = Color(songTags.swatches.DarkVibrant.hex)
		let light = Color(songTags.swatches.LightVibrant.hex)

		let contrastRatio = dark.contrast(light)

		while (contrastRatio < config.minContrast) {
			dark = dark.darken(config.constrastStepChange)
			light = light.lighten(config.constrastStepChange)
			contrastRatio = dark.contrast(light)
		}

		songTags.color = { dark, light }
	} else {
		songTags.art = `no_art.png`
		songTags.color = { dark: Color('#f00'), light: Color('#fff') }
	}
	return songTags
}

async function loadMusic() {
	for (let song of music) {
		if (song.tags) {
			continue
		}
		song.tags = await readTags(song.path)
		// update in song list
		listMusic()
	}
}

// load music

addMusic(path.join(os.homedir(), 'Music'))
loadMusic()
playRandom()

elAudio.addEventListener('ended', () => {
	playRandom()
})

elSkip.addEventListener('click', (e /*: MouseEvent*/) => {
	e.preventDefault()
	playRandom()
})

elPrevious.addEventListener('click', (e /*: MouseEvent*/) => {
	e.preventDefault()
	history.pop()
	let song = history.pop()
	if (song) {
		playSong(song)
	} else {
		playRandom()
	}
})

function playRandom() {
	let randomMusic = music[Math.floor(Math.random() * music.length)]
	if (!randomMusic) {
		return
	}
	playSong(randomMusic)
}

async function playSong(song: MusicData) {
	history.push(song)
	if (history.length > 1000) {
		history.shift()
	}

	currentlyPlaying = song.path
	listMusic()

	elAudio.src = song.path
	playpause(true)

	let elArt = forceElementById('nowplaying_art', HTMLImageElement)
	let elTitle = forceElementById('nowplaying_title', HTMLSpanElement)
	let elArtist = forceElementById('nowplaying_artist', HTMLSpanElement)
	let elLyrics = forceElementById('nowplaying_lyrics', HTMLParagraphElement)
	let elFilename = forceElementById('nowplaying_filename', HTMLSpanElement)
	let elNowPlaying = forceElementById('nowplaying', HTMLDivElement)

	elFilename.innerText = song.filename

	let songTags = song.tags || (await readTags(song.path))

	console.log(songTags)

	elArt.src = songTags.art
	elTitle.innerText = songTags.title
	elArtist.innerText = songTags.artist
	elLyrics.innerText = songTags.album

	// let vibrant = Vibrant.from(elArt); // not available in node
	if (!songTags.color) {
		return
	}

	if (config.lightMode) {
		document.documentElement.style.setProperty(
			'--foreground',
			songTags.color.dark.hex(),
		)
		document.documentElement.style.setProperty(
			'--background',
			songTags.color.light.hex(),
		)
		document.documentElement.style.setProperty('--background2', '#fff')
	} else {
		document.documentElement.style.setProperty(
			'--foreground',
			songTags.color.light.hex(),
		)
		document.documentElement.style.setProperty(
			'--background',
			songTags.color.dark.hex(),
		)
		document.documentElement.style.setProperty('--background2', '#000')
	}
}

let holder = document

holder.ondragover = () => {
	return false
}

holder.ondragleave = () => {
	return false
}

holder.ondragend = () => {
	return false
}

holder.ondrop = e => {
	e.preventDefault()

	if (!e.dataTransfer) {
		console.log('No datatransfer')
		alert('no datatransfer')
		return
	}
	console.log('Adding', e.dataTransfer.files.length, 'files.')
	Array.from(e.dataTransfer.files).forEach(f => addMusic(f.path))
	loadMusic()

	return false
}
