'use strict';

//////////////////////////////////////////////////////////////////////
// Global vars.

var g_is_playing = false;
var g_cues = [];

var g_current_cue_index = 0;

// "Video" time.
var g_time_ms = 0;
var g_time_displayed_seconds = null;

// These two variables are set during the "play" action.
// "Video" time.
var g_start_time_ms = null;
// Wallclock (actually, performance.now()) time.
var g_start_rttime_ms = null;

//////////////////////////////////////////////////////////////////////
// Misc. useful functions.

// Receives a number.
// Returns a string with at least two characters, adding zeros to the left.
function zero_pad(num) {
	var s = '' + Math.floor(num);
	while (s.length < 2) {
		s = '0' + s;
	}
	return s;
}

function milliseconds_to_text(ms) {
	var seconds = Math.round(ms / 1000);
	var minutes = Math.floor(seconds / 60);
	seconds = seconds % 60;
	var hours = Math.floor(minutes / 60);
	minutes = minutes % 60;

	return hours + ':' + zero_pad(minutes) + ':' + zero_pad(seconds);
}

//////////////////////////////////////////////////////////////////////
// SRT/VTT parsing functions.

function parse_timestamp(s) {
	var match = s.match(/^(?:([0-9]+):)?([0-5][0-9]):([0-5][0-9](?:[.,][0-9]{0,3})?)/);
	if (match == null) {
		throw 'Invalid timestamp format: ' + s;
	}
	var hours = parseInt(match[1] || "0", 10);
	var minutes = parseInt(match[2], 10);
	var seconds = parseFloat(match[3].replace(',', '.'));
	return seconds + 60 * minutes + 60 * 60 * hours;
}

// https://w3c.github.io/webvtt/
// https://developer.mozilla.org/en/docs/Web/API/Web_Video_Text_Tracks_Format
// https://en.wikipedia.org/wiki/WebVTT
//
// For better parsers, look at:
// https://github.com/annevk/webvtt
// https://github.com/mozilla/vtt.js
function quick_and_dirty_vtt_or_srt_parser(vtt) {
	var lines = vtt.trim().replace('\r\n', '\n').split(/[\r\n]/).map(function(line) {
		return line.trim();
	});
	var cues = [];
	var start = null;
	var end = null;
	var payload = null;
	for (var i = 0; i < lines.length; i++) {
		if (lines[i].indexOf('-->') >= 0) {
			var splitted = lines[i].split(/[ \t]+-->[ \t]+/);
			if (splitted.length != 2) {
				throw 'Error when splitting "-->": ' + lines[i];
			}

			// Already ignoring anything past the "end" timestamp (i.e. cue settings).
			start = parse_timestamp(splitted[0]);
			end = parse_timestamp(splitted[1]);
		} else if (lines[i] == '') {
			if (start && end) {
				var cue = new VTTCue(start, end, payload);
				cues.push(cue);
				start = null;
				end = null;
				payload = null;
			}
		} else if(start && end) {
			if (payload == null) {
				payload = lines[i];
			} else {
				payload += '\n' + lines[i];
			}
		}
	}
	if (start && end) {
		var cue = new VTTCue(start, end, payload);
		cues.push(cue);
	}

	return cues;
}

//////////////////////////////////////////////////////////////////////
// Engine facade (i.e. "external" API).

function toggle_play_pause() {
	if (g_is_playing) {
		pause();
	} else {
		play();
	}
}

function play() {
	g_is_playing = true;
	g_start_time_ms = g_time_ms;
	g_start_rttime_ms = window.performance.now();
	window.requestAnimationFrame(animation_frame_callback);
	update_play_pause_label();
}

function pause() {
	g_is_playing = false;
	update_play_pause_label();
}

function skip_to_next_cue() {
	if (g_current_cue_index >= g_cues.length - 1) return;

	var cue = get_current_cue();

	if (g_time_ms > cue.startTime) {
		g_current_cue_index++;
		cue = get_current_cue();
	}

	g_time_ms = cue.startTime * 1000;
	g_start_time_ms = g_time_ms;
	g_start_rttime_ms = window.performance.now();
	update_time_display();
	display_current_cue();
}

function skip_to_prev_cue() {
	if (g_current_cue_index <= 0) return;

	g_current_cue_index--;
	var cue = get_current_cue();

	g_time_ms = cue.startTime * 1000;
	g_start_time_ms = g_time_ms;
	g_start_rttime_ms = window.performance.now();
	update_time_display();
	display_current_cue();
}

function get_current_cue() {
	if (g_current_cue_index < g_cues.length) {
		return g_cues[g_current_cue_index];
	}
	return null;
}

//////////////////////////////////////////////////////////////////////
// Engine internals.

function advance_cues_until(seconds) {
	while (true) {
		var cue = get_current_cue();
		if (!cue) {
			return;
		} else if (seconds < cue.endTime) {
			break;
		} else {
			g_current_cue_index++;
		}
	}
}

function animation_frame_callback(now) {
	if (g_is_playing) {
		var delta_rttime = now - g_start_rttime_ms;
		var new_time_ms = g_start_time_ms + delta_rttime;

		var cue = get_current_cue();
		if (cue) {
			var seconds = g_time_ms / 1000;
			var new_seconds = new_time_ms / 1000;
			if (seconds < cue.endTime && new_seconds >= cue.endTime) {
				hide_cue();
				g_current_cue_index++;
				advance_cues_until(new_seconds);
				cue = get_current_cue();
			}
			if (cue && seconds < cue.startTime && new_seconds >= cue.startTime) {
				display_current_cue();
			}
		}

		g_time_ms = new_time_ms;
		update_time_display();
		window.requestAnimationFrame(animation_frame_callback);
	}
}

//////////////////////////////////////////////////////////////////////
// UI-related functions.

function update_play_pause_label() {
	var button = document.getElementById('playpause');
	button.value = g_is_playing ? '⏸' : '▶';
}

function update_time_display() {
	var div = document.getElementById('time');
	var seconds = Math.floor(g_time_ms / 1000);
	if (seconds != g_time_displayed_seconds) {
		div.textContent = milliseconds_to_text(g_time_ms);
		g_time_displayed_seconds = seconds;
	}
}

function hide_cue() {
	var elem = document.getElementById('subtitle');
	elem.innerHTML = '';
}

function display_current_cue() {
	var elem = document.getElementById('subtitle');
	elem.innerHTML = '';
	var cue = get_current_cue();
	if (cue) {
		elem.appendChild(cue.getCueAsHTML());
	}
}

function load_cues() {
	var script = document.getElementById('inputfile');
	g_cues = quick_and_dirty_vtt_or_srt_parser(script.innerHTML);
	g_current_cue_index = 0;
}

function init() {
	var playpause = document.getElementById('playpause');
	playpause.addEventListener('click', toggle_play_pause);

	var next = document.getElementById('next');
	next.addEventListener('click', skip_to_next_cue);

	var prev = document.getElementById('prev');
	prev.addEventListener('click', skip_to_prev_cue);

	load_cues();
	update_play_pause_label();
	update_time_display();
}

init();

