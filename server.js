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

// Rendered, not sent as a file, so {{.Host}} is substituted the way the ingest
// fleet's Caddy does it per request. It defaults to this server rather than
// leaving the placeholder in, which used to make the harness beacon
// ping.withcabin.com - i.e. every local test poked production with a pageview
// for hostname "localhost". Override with ?host= to aim it somewhere real.
app.get('/hello.js', (req, res) => {
	res.setHeader('Content-Type', 'application/javascript')
	res.render('dist/hello.js', { host: req.query.host || `localhost:${port}` })
})

app.listen(port, () => {
	console.log(`Test available at http://localhost:${port}`)
	console.log(
		`Client script available at http://localhost:${port}/hello.js?host=ping.withcabin.com`
	)
})
