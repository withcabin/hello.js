const express = require('express')
const fs = require('fs')
const path = require('path')

const app = express()
const port = 8000

const render = (filePath, options, callback) => {
	fs.readFile(filePath, (err, content) => {
		if (err) return callback(err)

		let rendered = content
			.toString()
			.replace(/{title}/g, options.title || '')
			.replace(/{linkTo}/g, options.linkTo || '')

		if (options.host) {
			rendered = rendered.replace(/{{\.Host}}/g, options.host)
		}

		return callback(null, rendered)
	})
}

app.engine('html', render)
app.engine('js', render)

app.set('views', './')
app.set('view engine', 'html')

app.get('/', (req, res) => {
	res.render('tests.html', { title: '/', linkTo: 'about' })
})

app.get('/about', (req, res) => {
	res.render('tests.html', { title: 'about', linkTo: '/' })
})

app.get('/hello.js', (req, res) => {
	res.setHeader('Content-Type', 'application/javascript')
	res.sendFile(path.join(__dirname, 'dist', 'hello.js'))
})

app.listen(port, () => {
	console.log(`Test available at http://localhost:${port}`)
	console.log(
		`Client script available at http://localhost:${port}/hello.js?host=ping.withcabin.com`
	)
})
