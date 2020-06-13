var fse = require('fs-extra');
const fetch = require("node-fetch");
// const { Image, getImageData, imageFromBuffer, imageFromImageData } = require('@canvas/image')
// const ImageData = require('@canvas/image-data');
// const blobToBase64 = require('blob-to-base64');
// var FileReader = require('filereader');
const { createCanvas, createImageData, loadImage } = require('canvas');
// import Dbase from './db.js';
// var MSQR = require('./msqr.js');

const proxy = 'https://pkk.rosreestr.ru/';
const proxy1 = 'https://pkk5.kosmosnimki.ru/';

var myArgs = process.argv.slice(2);
if (myArgs.length < 2) {
	console.error('Error use this format:', 'node cadPack.js inputFile outFile');
} else {
	var geoJsonFile = myArgs[1] + '.geojson';
	var skipedFile = myArgs[1] + '.skiped';
	if (fse.existsSync(geoJsonFile)) {
	  console.log('Sorry file ', geoJsonFile, ' exists!')
	} else {
	var data = fse.readFileSync(myArgs[0], 'utf8');
	var names = data.split('\n').reduce((p, c) => {
		p[c.trim()] = true;
		return p;
	}, {});

	const mInPixel = Math.pow(2, 28) / 40075016.685578496;	// для 20 зума
	const getIdByCn = function(cn) {
		if (!cn) return null; 
		let arr = cn.split(':');
		return arr.map(it => Number(it.trim())).join(':');
	};
	const getFeature = function(id, type) {
		type = type || 1;
		let url = proxy +  'api/features/' + type + '/' + id + '?date_format=%c&_=' + Date.now();
		return fetch(url)
		.then(function(req) { return req.json();})
		.catch(err => {return {id: id, err: err}});
	};
	const unproject = function (point) {
		var d = 180 / Math.PI;
		var r = 6378137;

		return {
			lat: (2 * Math.atan(Math.exp(point.y / r)) - (Math.PI / 2)) * d,
			lng: point.x * d / r
		};
	};
	const _sqDist = function (p1, p2) {
		var dx = p2.x - p1.x,
			dy = p2.y - p1.y;
		return dx * dx + dy * dy;
	}
	const _reducePoints = function (points, sqTolerance) {
		var reducedPoints = [points[0]];

		for (var i = 1, prev = 0, len = points.length; i < len; i++) {
			if (_sqDist(points[i], points[prev]) > sqTolerance) {
				reducedPoints.push(points[i]);
				prev = i;
			}
		}
		if (prev < len - 1) {
			reducedPoints.push(points[len - 1]);
		}
		return reducedPoints;
	}
	const _sqClosestPointOnSegment = function (p, p1, p2, sqDist) {
		var x = p1.x,
			y = p1.y,
			dx = p2.x - x,
			dy = p2.y - y,
			dot = dx * dx + dy * dy,
			t;

		if (dot > 0) {
			t = ((p.x - x) * dx + (p.y - y) * dy) / dot;

			if (t > 1) {
				x = p2.x;
				y = p2.y;
			} else if (t > 0) {
				x += dx * t;
				y += dy * t;
			}
		}

		dx = p.x - x;
		dy = p.y - y;

		return sqDist ? dx * dx + dy * dy : new Point(x, y);
	}

	const _simplifyDPStep = function (points, markers, sqTolerance, first, last) {

		var maxSqDist = 0,
		index, i, sqDist;

		for (i = first + 1; i <= last - 1; i++) {
			sqDist = _sqClosestPointOnSegment(points[i], points[first], points[last], true);

			if (sqDist > maxSqDist) {
				index = i;
				maxSqDist = sqDist;
			}
		}

		if (maxSqDist > sqTolerance) {
			markers[index] = 1;

			_simplifyDPStep(points, markers, sqTolerance, first, index);
			_simplifyDPStep(points, markers, sqTolerance, index, last);
		}
	}
	const _simplifyDP = function (points, sqTolerance) {

		var len = points.length,
			ArrayConstructor = typeof Uint8Array !== undefined + '' ? Uint8Array : Array,
			markers = new ArrayConstructor(len);

			markers[0] = markers[len - 1] = 1;

		_simplifyDPStep(points, markers, sqTolerance, 0, len - 1);

		var i,
			newPoints = [];

		for (i = 0; i < len; i++) {
			if (markers[i]) {
				newPoints.push(points[i]);
			}
		}

		return newPoints;
	}
	const simplify = function (points, tolerance) {
		if (!tolerance || !points.length) {
			return points.slice();
		}

		var sqTolerance = tolerance * tolerance;
		points = _reducePoints(points, sqTolerance);	// stage 1: vertex reduction
		points = _simplifyDP(points, sqTolerance);	// stage 2: Douglas-Peucker simplification

		return points;
	}

	const getImageUrl = function(it, bbox, exSize) {
		let id = it.attrs.id,
			extent = it.extent,
			type = it.type || 1,
			ids = [0, 1 , 2, 3, 4, 5, 6, 7, 8, 9, 10],
			params = {
				size: exSize.join(','),
				bbox: bbox,
				layers: 'show:' + ids.join(','),
				layerDefs: '{' + ids.map(function(nm) {
					return '\"' + nm + '\":\"ID = \'' + id + '\'"'
				}).join(',') + '}',
				format: 'png32',
				dpi: 96,
				transparent: 'true',
				imageSR: 102100,
				bboxSR: 102100
			},
			imageUrl = proxy1 +  'arcgis/rest/services/PKK6/';
		imageUrl += (type === 10 ? 'ZONESSelected' : 'CadastreSelected') + '/MapServer/export?f=image&cross=' + Math.random();

		for (let key in params) {
			imageUrl += '&' + key + '=' + params[key];
		}
		// console.log('exSize', exSize, params);
		return imageUrl;
	};

	var arr = Object.keys(names);
	// arr = arr.slice(arr.length - 114);
	// arr = ['50:27:0020543:29'];
	// fse.writeFileSync(skipedFile, '\n', 'utf8');
	fse.writeFileSync(geoJsonFile, '{\n\t"type": "FeatureCollection",\n\t"features":\n\t\t[\n\t\t', 'utf8');
	const getNext = function() {
		let cnn = arr.shift();
		let cn = getIdByCn(cnn);
		if (cn) {
			getFeature(cn).then(json => {
				let feature = json.feature;
				if (!feature) {
					fse.appendFileSync(skipedFile, cn + '\n', 'utf8');
					console.log('skiped', cnn, feature);
					getNext();
				} else {
	// console.log('feature', feature.attrs);
				let id = feature.attrs.id,
					extent = feature.extent,
					bbox = [extent.xmin, extent.ymin, extent.xmax, extent.ymax],
					w = Math.round((bbox[2] - bbox[0]) * mInPixel),
					h = Math.round((bbox[3] - bbox[1]) * mInPixel);
				if (w % 2) { w++; }
				if (h % 2) { h++; }
				let exSize = [w, h],
					url = getImageUrl(feature, bbox, exSize);
				fetch(url)
					.then(req => req.arrayBuffer())
					.then(blob => {
						var array = new Uint8ClampedArray(blob);
						if (array[0] === 137) {
// console.log('blob', array[0], array.length, array.width, array.height, w, h, w * h * 4)
						fse.writeFileSync('./test1.png', array);

						loadImage('./test1.png').then((image) => {
							const canv = createCanvas(w, h);
							var ctx = canv.getContext('2d');
							ctx.drawImage(image, 0, 0, canv.width, canv.height);
							// const buffer = canv.toBuffer('image/png');
							// fse.writeFileSync('./test.png', buffer);

							let pathPoints = MSQR(ctx, {path2D: false, maxShapes: 10});
							
	  // console.log('blob', pathPoints.length, pathPoints)
							
							var rings = pathPoints.map(function (it) {
								var ring = it.map(function (p) {
									return {
										x: extent.xmin + p.x / mInPixel,
										y: extent.ymin + (exSize[1] - p.y)/ mInPixel
									};
									// return L.point(p.x, exSize[1] - p.y)._divideBy(attr.mInPixel)._add({x: attr.extent.xmin, y: attr.extent.ymin});
								});
								ring = simplify(ring, 1);
								return ring.map(function (p) {
									return unproject(p);
									// return map.containerPointToLatLng(p);
								});
							});
	  console.log('rings', rings.length, 'for', id);
							var len = rings.length;
							if (len) {
								var type = 'Polygon',
									coords = rings.map(function (ring) {
										return ring.map(function (latlng) {
											return [latlng.lng, latlng.lat];
										});
									});
								if (len > 1) {
									type = 'Multi' + type;
									coords = [coords];
								}
								let _geoFson = {
									geometry: { type: type, coordinates: coords },
									type: 'Feature',
									properties: feature
								};
								let out = JSON.stringify(_geoFson);
								if (arr.length) {
									out += ',\n\t\t';
								} else {
									out += '\n]\n}';
								}
								fse.appendFileSync(geoJsonFile, out, 'utf8');
							}

							// fse.appendFileSync(geoJsonFile, JSON.stringify(json) + '\n\t\t', 'utf8');
						});
						} else {
							fse.appendFileSync(skipedFile, id + '\n', 'utf8');
							console.log('skiped', id);
						}
						getNext();
					});
				}
			});
		} else {
			fse.appendFileSync(skipedFile, cnn + '\n', 'utf8');
			console.log('skiped', cnn);
		}
	};
	getNext();
	}
}
/*eslint-disable */
/*!
	MSQR v0.2.1 alpha
	(c) 2016 K3N / Epistemex
	www.epistemex.com
	MIT License
*/

/**
 * Convert a canvas, context, image or video frame to a path that aligns with the outline of the non-alpha pixels
 * using an optimized version of the marching squares algorithm.
 *
 * Alpha threshold can be adjusted. Optional point reduction can be performed to reduce total number of points.
 *
 * Embeds alignment feature to produce tighter fit. Can pre-align before point reduction as well.
 *
 * Use maxShapes to trace more than 1 shape.
 *
 * @param {*} src - source is either canvas, context, image or video (note: only webm video format supports alpha channel. webm is only available in Chrome/Opera).
 * @param {*} [options] - an optional option object to tweak values or to set clip
 * @param {number} [options.x] - set x for clipping bound. Default is 0.
 * @param {number} [options.y] - set y for clipping bound. Default is 0.
 * @param {number} [options.width] - set width for clipping bound. Default is width of source.
 * @param {number} [options.height] - set height for clipping bound. Default is c of source.
 * @param {number} [options.alpha=0] - alpha level [0, 254] to use for clipping. Any alpha value in the image above this value is considered a solid pixel.
 * @param {number} [options.tolerance=0] - point reduction tolerance in pixels. If 0 no point reduction is performed. Recommended values [0.7, 1.5]
 * @param {number} [options.bleed=5] - if maxShapes > 1 activates bleed mask for removing a traced shape.
 * @param {number} [options.maxShapes=1] - maximum number of shapes to trace. Minimum is 1. No upper limit but be careful not to block the browser.
 * @param {boolean} [options.align=false] - Attempts to align points to edge after reduction or with path if no reduction is performed. Disabled if padding is enabled.
 * @param {number} [options.alignWeight=0.95] - Weighting a aligned point to avoid overlapping points.
 * @param {number} [options.padding=0] - Add padding before tracing (radius). Use negative value to contract. Padding overrides and disables aligning if enabled.
 * @param {boolean} [options.path2D=false] - Return array holding Path2D objects instead of point arrays.
 * @returns {Array} Holds arrays with points for each shape, or if path2D=true an Path2D object for each shape
 * @static
 */
function MSQR(ctx, options) {

	"use strict";

	options = options || {};

	// var ctx;

	// if (src instanceof CanvasRenderingContext2D) {
		// ctx = src;
	// }
	// else if (src instanceof HTMLCanvasElement) {
		// ctx = src.getContext("2d");
	// }
	// else if (src instanceof HTMLImageElement || src instanceof HTMLVideoElement) {
		// ctx = img2context(src);
	// }
	// else throw "Invalid source.";

	var w           = ctx.canvas.width,
		h           = ctx.canvas.height,
		cx          = (options.x || 0)|0,
		cy          = (options.y || 0)|0,
		cw          = (options.width || w)|0,
		ch          = (options.height || h)|0,
		bu, paths   = [], path,
		lastPos = 3, i, pt, // for recursive calls
		bleed       = Math.max(1, options.bleed || 5),
		max         = Math.max(1, options.maxShapes || 1),
		alpha       = Math.max(0, Math.min(254, options.alpha || 0)),
		padding 	= options.padding || 0,
		tolerance   = Math.max(0, options.tolerance || 0),
		doAlign     = !!options.align,
		alignWeight = options.alignWeight || 0.95,
		retPath     = !!options.path2D,
		ctx2, inc;

	// check bounds
	if (cx < 0 || cy < 0 || cx >= w  || cy >= h ||
		cw < 1 || ch < 1 || cx + cw > w || cy + ch > h)
		return [];

	// recursive? make backup since we will need to remove shapes
	if (max > 1 || padding) {

		// backup bitmap so we can mess around
		bu = img2context(ctx.canvas);

		// force reset so we won't get surprises
		ctx.save();
		ctx.setTransform(1,0,0,1,0,0);
		ctx.fillStyle = ctx.strokeStyle = "#000";
		ctx.globalAlpha = 1;
		ctx.shadowColor = "rgba(0,0,0,0)";

		// Padding redraws the image in n number of timer around center
		// to extend the edges.
		if (padding) {

			ctx2 = img2context(ctx.canvas);
			inc = padding < 0 ? 4 : (padding > 5 ? 16 : 8);

			ctx.globalCompositeOperation =
				padding < 0 ? "destination-in" : "source-over";

			padding = Math.min(10, Math.abs(padding));

			for(var angle = 0, step = Math.PI * 2 / inc; angle < 6.28; angle += step)
				ctx.drawImage(ctx2.canvas, padding * Math.cos(angle), padding * Math.sin(angle));
		}

		// loop to find each shape
		ctx.globalCompositeOperation = "destination-out";
		ctx.lineWidth = bleed;
		ctx.miterLimit = 1;

		do {
			path = trace();
			if (path.length) {

				// add to list
				paths.push(retPath ? points2path(path) : path);

				// remove traced shape
				ctx.beginPath();
				i = path.length - 1;
				while(pt = path[i--]) ctx.lineTo(pt.x, pt.y);
				ctx.closePath();
				ctx.fill();
				ctx.stroke();
			}
		}
		while(path.length && --max);

		// restore bitmap to original
		ctx.globalCompositeOperation = "source-over";
		ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
		ctx.drawImage(bu.canvas, 0, 0);
		ctx.restore();

		return paths
	}
	else {
		path = trace();
		paths.push(retPath ? points2path(path) : path);
	}

	return paths;

	/*
		Trace
	 */
	function trace() {

		var path = [],
			data, l,
			i, x, y, sx, sy,
			start = -1,
			step, pStep = 9,
			steps = [9, 0, 3, 3, 2, 0, 9, 3, 1, 9, 1, 1, 2, 0, 2, 9];

		data = new Uint32Array(ctx.getImageData(cx, cy, cw, ch).data.buffer);
		l = data.length;

		// start position
		for(i = lastPos; i < l; i++) {
			if ((data[i]>>>24) > alpha) {
				start = lastPos = i;
				break
			}
		}

		// march from start point until start point
		if (start >= 0) {

			// calculate start position
			x = sx = (start % cw) | 0;
			y = sy = (start / cw) | 0;

			do {
				step = getNextStep(x, y);

				if (step === 0) y--;
				else if (step === 1) y++;
				else if (step === 2) x--;
				else if (step === 3) x++;

				if (step !== pStep) {
					path.push({x: x + cx, y: y + cy});
					pStep = step;
				}
			}
			while(x !== sx || y !== sy);

			// point reduction?
			if (tolerance)
				path = reduce(path, tolerance);

			// align? (only if no padding)
			if (doAlign && !padding)
				path = align(path, alignWeight);
		}

		// lookup pixel
		function getState(x, y) {
			return (x >= 0 && y >= 0 && x < cw && y < ch) ? (data[y * cw + x]>>>24) > alpha : false
		}

		// Parse 2x2 pixels to determine next step direction.
		// See https://en.wikipedia.org/wiki/Marching_squares for details.
		// Note: does not do clockwise cycle as in the original specs, but line by line.
		function getNextStep(x, y) {

			var v = 0;
			if (getState(x - 1, y - 1)) v |= 1;
			if (getState(x, y - 1)) v |= 2;
			if (getState(x - 1, y)) v |= 4;
			if (getState(x, y)) v |= 8;

			if (v === 6)
				return pStep === 0 ? 2 : 3;
			else if (v === 9)
				return pStep === 3 ? 0 : 1;
			else
				return steps[v];
		}

		// Ramer Douglas Peucker with correct distance point-to-line
		function reduce(points, epsilon) {

			var len1 = points.length - 1;
			if (len1 < 2) return points;

			var fPoint = points[0],
				lPoint = points[len1],
				epsilon2 = epsilon * epsilon,
				i, index = -1,
				cDist, dist = 0,
				l1, l2, r1, r2;

			for (i = 1; i < len1; i++) {
				cDist = distPointToLine(points[i], fPoint, lPoint);
				if (cDist > dist) {
					dist = cDist;
					index = i
				}
			}

			if (dist > epsilon2) {
				l1 = points.slice(0, index + 1);
				l2 = points.slice(index);
				r1 = reduce(l1, epsilon);
				r2 = reduce(l2, epsilon);
				return r1.slice(0, r1.length - 1).concat(r2)
			}
			else
				return [fPoint, lPoint]
		}

		function distPointToLine(p, l1, l2) {

			var lLen = dist(l1, l2), t;

			if (!lLen)
				return 0;

			t = ((p.x - l1.x) * (l2.x - l1.x) + (p.y - l1.y) * (l2.y - l1.y)) / lLen;

			if (t < 0)
				return dist(p, l1);
			else if (t > 1)
				return dist(p, l2);
			else
				return dist(p, { x: l1.x + t * (l2.x - l1.x), y: l1.y + t * (l2.y - l1.y)});
		}

		function dist(p1, p2) {
			var dx = p1.x - p2.x,
				dy = p1.y - p2.y;
			return dx * dx + dy * dy
		}

		// Align by K3N
		function align(points, w) {

			var ox = [1, -1, -1, 1],
				oy = [1, 1, -1, -1],
				p, t = 0;

			while(p = points[t++]) {

				p.x = Math.round(p.x);
				p.y = Math.round(p.y);

				for(var i = 0, tx, ty, dx, dy; i < 4; i++) {
					dx = ox[i];
					dy = oy[i];
					tx = p.x + (dx<<1);
					ty = p.y + (dy<<1);
					if (tx > cx && ty > cy && tx < cw - 1 && ty < ch - 1) {
						if (!getState(tx, ty)) {
							tx -= dx;
							ty -= dy;
							if (getState(tx, ty)) {
								p.x += dx * w;
								p.y += dy * w;
							}
						}
					}
				}
			}

			return points
		}

		return path
	}

	/*
		Helper functions
	 */

	function img2context(src) {
		var c = createCanvas(src.width, src.height);
		// var c = document.createElement("canvas"), ctx;
		c.width = src.naturalWidth || src.videoWidth || src.width;
		c.height = src.naturalHeight || src.videoHeight || src.height;
		ctx = c.getContext("2d");
		ctx.drawImage(src, 0, 0);
		return ctx
	}

	function points2path(points) {

		var path = new Path2D(),
			i = 0, point;

		while(point = points[i++])
			path.lineTo(point.x, point.y);

		path.closePath();
		return path
	}

}

/**
 * Generic function to obtain boundaries of an array with points. The
 * array contains point objects with properties x and y.
 *
 * @example
 *
 *     var rect = MSQR.getBounds(points);
 *
 * @param {Array} points - point array with point objects
 * @returns {{x: Number, y: Number, width: number, height: number}}
 * @name MSQR.getBounds
 * @function
 * @global
 */
MSQR.getBounds = function(points) {

	var minX = 9999999, minY = 9999999,
		maxX = -9999999, maxY = -9999999,
		i, l = points.length;

	for(i = 0; i < l; i++) {
		if (points[i].x > maxX) maxX = points[i].x;
		if (points[i].x < minX) minX = points[i].x;
		if (points[i].y > maxY) maxY = points[i].y;
		if (points[i].y < minY) minY = points[i].y;
	}

	return {
		x: minX|0,
		y: minY|0,
		width: Math.ceil(maxX - minX),
		height: Math.ceil(maxY - minY)
	}
};

// export { MSQR as default };
/*eslint-enable */
