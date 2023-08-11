// Due to certain circumstances,
// I decided to revive the code from when I implemented GPU particles a long time ago.
// 2023/02/04
// Hello!
// I referred to h_doxas's wonderful reference.：https://wgld.org/d/webgl/w083.html
// Some people implemented it with Three.js, but I stuck to implementing it with p5.js.
// Because createShader() and setUniform() were convenient.

// --------------------------------------------------------------- //
// global.

let _gl, gl;

let _node; // A node for accessing the RenderSystemSet.

let accell = 0; // acceleration
let properFrameCount = 0; // count to change color

let bg, bgTex, base; // Global variable for background (but you need texture object to use it)

const TEX_SIZE = 512; // The number of particles is 512x512

let fb, fb2, flip;
// First, register the position and velocity in fb using pointVert and pointFrag.
// Then it bakes its contents into fb2 using moveVert and moveFrag.
// After executing pointillism using fb2, swap fb2 and fb.

// --------------------------------------------------------------- //
// shader.

// dataShader. Set initial position and velocity
const dataVert =
	'precision mediump float;' +
	'attribute vec3 aPosition;' + // unique attribute.
	'void main(){' +
	'  gl_Position = vec4(aPosition, 1.0);' +
	'}';

const dataFrag =
	'precision mediump float;' +
	'uniform float uTexSize;' +
	'void main(){' +
	'  vec2 p = gl_FragCoord.xy / uTexSize;' + // normalize to 0.0～1.0
	// Set initial position and initial velocity
	'  vec2 pos = (p - 0.5) * 2.0;' + // position:-1～1,-1～1
	'  gl_FragColor = vec4(pos, 0.0, 0.0);' + // velocity:0
	'}';

// bgShader. draw background.
const bgVert =
	'precision mediump float;' +
	'attribute vec3 aPosition;' +
	'void main(){' +
	'  gl_Position = vec4(aPosition, 1.0);' +
	'}';

const bgFrag =
	'precision mediump float;' +
	'uniform sampler2D uTex;' +
	'uniform vec2 uResolution;' +
	'void main(){' +
	'  vec2 p = gl_FragCoord.xy / uResolution.xy;' +
	'  p.y = 1.0 - p.y;' +
	'  gl_FragColor = texture2D(uTex, p);' +
	'}';

// moveShader. Update position and velocity with offscreen rendering
const moveVert =
	'precision mediump float;' +
	'attribute vec3 aPosition;' +
	'void main(){' +
	'  gl_Position = vec4(aPosition, 1.0);' +
	'}';

const moveFrag =
	'precision mediump float;' +
	'uniform sampler2D uTex;' +
	'uniform float uTexSize;' +
	'uniform vec2 uMouse;' +
	'uniform bool uMouseFlag;' +
	'uniform float uAccell;' +
	'const float SPEED = 0.05;' +
	'void main(){' +
	'  vec2 p = gl_FragCoord.xy / uTexSize;' + // pixel position.
	'  vec4 t = texture2D(uTex, p);' +
	'  vec2 pos = t.xy;' +
	'  vec2 velocity = t.zw;' +
	// update.
	'  vec2 v = normalize(uMouse - pos) * 0.2;' +
	'  vec2 w = normalize(velocity + v);' + // normalize.
	'  vec4 destColor = vec4(pos + w * SPEED * uAccell, w);' +
	// Decrease speed when the mouse is not pressed.
	'  if(!uMouseFlag){ destColor.zw = velocity; }' +
	'  gl_FragColor = destColor;' +
	'}';

// pointShader. Draw points based on location information
const pointVert =
	'precision mediump float;' +
	'attribute float aIndex;' +
	'uniform sampler2D uTex;' +
	'uniform vec2 uResolution;' + // resolution.
	'uniform float uTexSize;' + // for texture fetch.
	'uniform float uPointScale;' +
	'void main() {' +
	// count: uTexSize * uTexSize
	// Add 0.5 to access the grid correctly.
	'  float x = (mod(aIndex, uTexSize) + 0.5) / uTexSize;' +
	'  float y = (floor(aIndex / uTexSize) + 0.5) / uTexSize;' +
	'  vec4 t = texture2D(uTex, vec2(x, y));' +
	'  vec2 p = t.xy;' +
	'  p *= vec2(min(uResolution.x, uResolution.y)) / uResolution;' +
	'  gl_Position = vec4(p, 0.0, 1.0);' +
	'  gl_PointSize = 0.1 + uPointScale;' + // Increase only when in motion.
	'}';

const pointFrag =
	'precision mediump float;' +
	'uniform vec4 uAmbient;' + // particle color.
	'void main(){' +
	'  gl_FragColor = uAmbient;' +
	'}';

// --------------------------------------------------------------- //
// setup.

function setup() {
	// _gl: rendering context for p5.webgl, gl: rendering context for webgl.
	_gl = createCanvas(1112, 834, WEBGL);
	pixelDensity(1);
	gl = _gl.GL;

	// Check if float texture is available
	textureFloatCheck();

	// Array containing indices for pointillism
	let indices = [];
	// index: 0～TEX_SIZE*TEX_SIZE-1
	for (let i = 0; i < TEX_SIZE * TEX_SIZE; i++) {
		indices.push(i);
	}
	// For plate polygon vertices
	const positions = [
		-1.0, 1.0, 0.0, -1.0, -1.0, 0.0, 1.0, 1.0, 0.0, 1.0, -1.0, 0.0
	];

	// node.
	_node = new RenderNode();

	// dataShader: For initial point position and velocity
	const dataShader = createShader(dataVert, dataFrag);
	_node.registRenderSystem('data', dataShader);
	_node.use('data', 'plane');
	_node.registAttribute('aPosition', positions, 3);

	// bgShader: for background.
	const bgShader = createShader(bgVert, bgFrag);
	_node.registRenderSystem('bg', bgShader);
	_node.use('bg', 'plane');
	_node.registAttribute('aPosition', positions, 3);
	_node.registUniformLocation('uTex');

	// moveShader: for updating point positions and velocities
	const moveShader = createShader(moveVert, moveFrag);
	_node.registRenderSystem('move', moveShader);
	_node.use('move', 'plane');
	_node.registAttribute('aPosition', positions, 3);
	_node.registUniformLocation('uTex');

	// pointShader: for drawing points
	const pointShader = createShader(pointVert, pointFrag);
	_node.registRenderSystem('point', pointShader);
	_node.use('point', 'points');
	_node.registAttribute('aIndex', indices, 1);
	_node.registUniformLocation('uTex');

	// framebuffers.
	fb = create_framebuffer(TEX_SIZE, TEX_SIZE, gl.FLOAT);
	fb2 = create_framebuffer(TEX_SIZE, TEX_SIZE, gl.FLOAT);
	flip = fb;

	// Initialization of position and velocity
	defaultRendering();

	// prepare background image.
	prepareBackground();
	bgTex = new p5.Texture(_gl, bg); // create texture object.

	noStroke();
}

// --------------------------------------------------------------- //
// main loop.

function draw() {
	// Adjust mouse values to fit full screen
	const _size = min(width, height);
	const mouse_x = ((mouseX / width - 0.5) * 2.0 * width) / _size;
	const mouse_y = (-(mouseY / height - 0.5) * 2.0 * height) / _size;
	const mouse_flag = mouseIsPressed;

	// Update position and velocity
	moveRendering(mouse_x, mouse_y, mouse_flag);

	// draw background
	_node.use('bg', 'plane');
	_node.setAttribute();
	_node.setTexture('uTex', bgTex.glTex, 0);
	_node.setUniform('uResolution', [width, height]);
	// drawCall
	gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
	_node.clear(); // clear

	// blend enable
	gl.enable(gl.BLEND);
	gl.blendFunc(gl.ONE, gl.ONE);

	// draw points
	_node.use('point', 'points');
	_node.setAttribute();
	_node.setTexture('uTex', fb2.t, 0);
	const ambient = HSBA_to_RGBA((properFrameCount % 360) / 3.6, 100, 80);
	_node
		.setUniform('uTexSize', TEX_SIZE)
		.setUniform('uPointScale', accell)
		.setUniform('uAmbient', ambient)
		.setUniform('uResolution', [width, height]);
	// drawCall
	gl.drawArrays(gl.POINTS, 0, TEX_SIZE * TEX_SIZE);
	gl.flush(); // flush when all drawing is done
	_node.clear(); // clear

	gl.disable(gl.BLEND); // disable blend

	// swap.
	flip = fb;
	fb = fb2;
	fb2 = flip;

	// step.
	properFrameCount++;

	// Adjust acceleration
	if (mouse_flag) {
		accell = 1.0;
	} else {
		accell *= 0.95;
	}

	// Update background image
	bg.image(base, 0, 0);
	bg.text(frameRate().toFixed(3), 20, 20);
	bgTex.update();
}

// --------------------------------------------------------------- //
// texture float usability check.

function textureFloatCheck() {
	const ext =
		gl.getExtension('OES_texture_float') ||
		gl.getExtension('OES_texture_half_float');
	if (ext == null) {
		alert('float texture not supported');
		return;
	}
}

// --------------------------------------------------------------- //
// offscreen rendering.

function defaultRendering() {
	// bind framebuffer
	gl.bindFramebuffer(gl.FRAMEBUFFER, fb.f);
	// set viewport
	gl.viewport(0, 0, TEX_SIZE, TEX_SIZE);

	clear(); // clear offscreen

	_node.use('data', 'plane');
	_node.setAttribute();
	_node.setUniform('uTexSize', TEX_SIZE);
	// drawCall
	gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
	_node.clear(); // clear

	gl.viewport(0, 0, width, height); // reset viewport
	gl.bindFramebuffer(gl.FRAMEBUFFER, null); // unbind
}

// updating position and velocity
function moveRendering(mx, my, mFlag) {
	// Receive the contents of fb, update it and burn it to fb2
	gl.bindFramebuffer(gl.FRAMEBUFFER, fb2.f);
	gl.viewport(0, 0, TEX_SIZE, TEX_SIZE);

	clear();

	_node.use('move', 'plane');
	_node.setAttribute();
	_node.setTexture('uTex', fb.t, 0);
	_node
		.setUniform('uTexSize', TEX_SIZE)
		.setUniform('uAccell', accell)
		.setUniform('uMouseFlag', mFlag)
		.setUniform('uMouse', [mx, my]);
	// drawCall
	gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
	_node.clear(); // clear.

	gl.viewport(0, 0, width, height); // reset viewport
	gl.bindFramebuffer(gl.FRAMEBUFFER, null); // unbind
}

// --------------------------------------------------------------- //
// prepare background.

// prepare background (2D drawing)
function prepareBackground() {
	bg = createGraphics(width, height);
	base = createGraphics(width, height);

	bg.textSize(16);
	bg.textAlign(LEFT, TOP);
	base.background(0);
	base.textAlign(CENTER, CENTER);
	base.textSize(min(width, height) * 0.04);
	base.fill(255);
	//base.text("This is GPGPU TEST.", width * 0.5, height * 0.45);
	//base.text("Press down the mouse to move", width * 0.5, height * 0.5);
	//base.text("Release the mouse to stop", width * 0.5, height * 0.55);
	bg.fill(255);
	bg.image(base, 0, 0);
}

// --------------------------------------------------------------- //
// framebuffer.

// create framebuffer object.
function create_framebuffer(w, h, format) {
	// check format.
	let textureFormat = null;
	if (!format) {
		textureFormat = gl.UNSIGNED_BYTE;
	} else {
		textureFormat = format;
	}

	// create framebuffer
	let frameBuffer = gl.createFramebuffer();

	// bind framebuffer
	gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuffer);

	// Creating renderbuffers for depth buffer and bind it
	let depthRenderBuffer = gl.createRenderbuffer();
	gl.bindRenderbuffer(gl.RENDERBUFFER, depthRenderBuffer);

	// Set Render Buffer as Depth Buffer
	gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);

	// Associate a renderbuffer with a framebuffer
	gl.framebufferRenderbuffer(
		gl.FRAMEBUFFER,
		gl.DEPTH_ATTACHMENT,
		gl.RENDERBUFFER,
		depthRenderBuffer
	);

	// Generating textures for framebuffers
	let fTexture = gl.createTexture();

	// bind texture
	gl.bindTexture(gl.TEXTURE_2D, fTexture);

	// Reserve memory area for color in framebuffer texture
	gl.texImage2D(
		gl.TEXTURE_2D,
		0,
		gl.RGBA,
		w,
		h,
		0,
		gl.RGBA,
		textureFormat,
		null
	);

	// texture parameter
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

	gl.framebufferTexture2D(
		gl.FRAMEBUFFER,
		gl.COLOR_ATTACHMENT0,
		gl.TEXTURE_2D,
		fTexture,
		0
	);

	gl.bindTexture(gl.TEXTURE_2D, null);
	gl.bindRenderbuffer(gl.RENDERBUFFER, null);
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);

	return { f: frameBuffer, d: depthRenderBuffer, t: fTexture };
}

// --------------------------------------------------------------- //
// for attributes.
// attributeの登録とvboの取得、及び描画時のbindを行う関数。

function create_vbo(data) {
	// バッファオブジェクトの生成
	let vbo = gl.createBuffer();

	// バッファをバインドする
	gl.bindBuffer(gl.ARRAY_BUFFER, vbo);

	// バッファにデータをセット
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);

	// バッファのバインドを無効化
	gl.bindBuffer(gl.ARRAY_BUFFER, null);

	// 生成したVBOを返して終了
	return vbo;
}

function set_attribute(attributes) {
	// 引数として受け取った配列を処理する
	for (let name of Object.keys(attributes)) {
		const attr = attributes[name];
		// バッファをバインドする
		gl.bindBuffer(gl.ARRAY_BUFFER, attr.vbo);

		// attributeLocationを有効にする
		gl.enableVertexAttribArray(attr.location);

		// attributeLocationを通知し登録する
		gl.vertexAttribPointer(
			attr.location,
			attr.stride,
			gl.FLOAT,
			false,
			0,
			0
		);
	}
}

// --------------------------------------------------------------- //
// utility.

// HSBデータを受け取ってRGBAを取得する関数
// デフォではHSBを0～100で指定すると長さ4の配列でRGBが0～1でAが1の
// ものを返す仕様となっている
function HSBA_to_RGBA(h, s, b, a = 1, max_h = 100, max_s = 100, max_b = 100) {
	let hue = (h * 6) / max_h; // We will split hue into 6 sectors.
	let sat = s / max_s;
	let val = b / max_b;

	let RGB = [];

	if (sat === 0) {
		RGB = [val, val, val]; // Return early if grayscale.
	} else {
		let sector = Math.floor(hue);
		let tint1 = val * (1 - sat);
		let tint2 = val * (1 - sat * (hue - sector));
		let tint3 = val * (1 - sat * (1 + sector - hue));
		switch (sector) {
			case 1:
				RGB = [tint2, val, tint1];
				break;
			case 2:
				RGB = [tint1, val, tint3];
				break;
			case 3:
				RGB = [tint1, tint2, val];
				break;
			case 4:
				RGB = [tint3, tint1, val];
				break;
			case 5:
				RGB = [val, tint1, tint2];
				break;
			default:
				RGB = [val, tint3, tint1];
				break;
		}
	}
	return [...RGB, a];
}

// --------------------------------------------------------------- //
// RenderSystem class.
// shaderとprogramとtopologyのsetとあとテクスチャのロケーションのset
// 描画機構

class RenderSystem {
	constructor(name, _shader) {
		this.name = name;
		this.shader = _shader;
		shader(_shader);
		this.program = _shader._glProgram;
		this.topologies = {};
		this.uniformLocations = {};
	}
	getName() {
		return this.name;
	}
	registTopology(topologyName) {
		if (this.topologies[topologyName] !== undefined) {
			return;
		}
		this.topologies[topologyName] = new Topology(topologyName);
	}
	getProgram() {
		return this.program;
	}
	getShader() {
		return this.shader;
	}
	getTopology(topologyName) {
		return this.topologies[topologyName];
	}
	registUniformLocation(uniformName) {
		if (this.uniformLocations[uniformName] !== undefined) {
			return;
		}
		this.uniformLocations[uniformName] = gl.getUniformLocation(
			this.program,
			uniformName
		);
	}
	setTexture(uniformName, _texture, locationID) {
		gl.activeTexture(gl.TEXTURE0 + locationID);
		gl.bindTexture(gl.TEXTURE_2D, _texture);
		gl.uniform1i(this.uniformLocations[uniformName], locationID);
	}
}

// --------------------------------------------------------------- //
// RenderNode class.
// RenderSystemを登録して名前で切り替えられるようになっている
// さらにRenderSystemごとにTopology（geometryに相当する）を複数登録して
// それも切り替えできるようにする
class RenderNode {
	constructor() {
		this.renderSystems = {};
		this.currentRenderSystem = undefined;
		this.currentShader = undefined;
		this.currentTopology = undefined;
		this.useTextureFlag = false;
	}
	registRenderSystem(renderSystemName, _shader) {
		if (this.renderSystems[renderSystemName] !== undefined) {
			return;
		}
		this.renderSystems[renderSystemName] = new RenderSystem(
			renderSystemName,
			_shader
		);
	}
	use(renderSystemName, topologyName) {
		// まとめてやれた方がいい場合もあるので
		if (this.renderSystems[renderSystemName] == undefined) {
			return;
		}
		this.useRenderSystem(renderSystemName);
		this.registTopology(topologyName); // 登録済みなら何もしない
		this.useTopology(topologyName);
	}
	useRenderSystem(renderSystemName) {
		// 使うプログラムを決める
		this.currentRenderSystem = this.renderSystems[renderSystemName];
		this.currentShader = this.currentRenderSystem.getShader();
		this.currentShader.useProgram();
	}
	registTopology(topologyName) {
		// currentProgramに登録するので事前にuseが必要ですね
		this.currentRenderSystem.registTopology(topologyName);
	}
	useTopology(topologyName) {
		// たとえば複数のトポロジーを使い回す場合ここだけ切り替える感じ
		this.currentTopology =
			this.currentRenderSystem.getTopology(topologyName);
	}
	registAttribute(attributeName, data, stride) {
		this.currentTopology.registAttribute(
			this.currentRenderSystem.getProgram(),
			attributeName,
			data,
			stride
		);
	}
	setAttribute() {
		// その時のtopologyについて準備する感じ
		this.currentTopology.setAttribute();
	}
	registUniformLocation(uniformName) {
		this.currentRenderSystem.registUniformLocation(uniformName);
	}
	setTexture(uniformName, _texture, locationID) {
		this.currentRenderSystem.setTexture(uniformName, _texture, locationID);
		this.useTextureFlag = true; // 1回でも使った場合にtrue
	}
	setUniform(uniformName, data) {
		this.currentShader.setUniform(uniformName, data);
		return this;
	}
	clear() {
		// 描画の後処理
		// topologyを切り替える場合にも描画後にこれを行なったりする感じ
		this.currentTopology.clear();
		// textureを使っている場合はbindを解除する
		if (this.useTextureFlag) {
			gl.bindTexture(gl.TEXTURE_2D, null);
			this.useTextureFlag = false;
		}
	}
}

// --------------------------------------------------------------- //
// Topology class.
// シェーダーごとに設定
// Geometryだと名前がかぶるのでTopologyにした（一応）
// 描画に必要な情報の一揃え。

class Topology {
	constructor(name) {
		this.name = name;
		this.attributes = {};
	}
	getName() {
		return this.name;
	}
	registAttribute(program, attributeName, data, stride) {
		let attr = {};
		attr.vbo = create_vbo(data);
		attr.location = gl.getAttribLocation(program, attributeName);
		attr.stride = stride;
		this.attributes[attributeName] = attr;
	}
	setAttribute() {
		set_attribute(this.attributes);
	}
	clear() {
		// 描画が終わったらbindを解除する
		gl.bindBuffer(gl.ARRAY_BUFFER, null);
	}
}

// save jpg
let lapse = 0; // mouse timer
function mouseReleased() {
	if (millis() - lapse > 400) {
		save(
			'img_' +
				month() +
				'-' +
				day() +
				'_' +
				hour() +
				'-' +
				minute() +
				'-' +
				second() +
				'.jpg'
		);
		lapse = millis();
	}
}
