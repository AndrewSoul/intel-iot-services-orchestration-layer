/******************************************************************************
Copyright (c) 2016, Intel Corporation

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright notice,
      this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.
    * Neither the name of Intel Corporation nor the names of its contributors
      may be used to endorse or promote products derived from this software
      without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*****************************************************************************/
/**
 * Copyright 2013,2015 IBM Corp.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 **/

module.exports = function(RED) {
    "use strict";
    var spawn = require('child_process').spawn;
    var exec = require('child_process').exec;
    var isUtf8 = require('is-utf8');

    function ExecNode(n) {
        RED.nodes.createNode(this,n);
        this.cmd = (n.command || "").trim();
        if (n.addpay === undefined) { n.addpay = true; }
        this.addpay = n.addpay;
        this.append = (n.append || "").trim();
        this.useSpawn = n.useSpawn;
        this.timer = Number(n.timer || 0)*1000;
        this.activeProcesses = {};
        var node = this;

        var cleanup = function(p) {
            //console.log("CLEANUP!!!",p);
            node.activeProcesses[p].kill();
            node.status({fill:"red",shape:"dot",text:"timeout"});
            node.error("Exec node timeout");
        }

        this.on("input", function(msg) {
            var child;
            node.status({fill:"blue",shape:"dot",text:" "});
            if (this.useSpawn === true) {
                // make the extra args into an array
                // then prepend with the msg.payload
                var arg = node.cmd;
                if ((node.addpay === true) && msg.hasOwnProperty("payload")) { arg += " "+msg.payload; }
                if (node.append.trim() !== "") { arg += " "+node.append; }
                // slice whole line by spaces (trying to honour quotes);
                arg = arg.match(/(?:[^\s"]+|"[^"]*")+/g);
                var cmd = arg.shift();
                /* istanbul ignore else  */
                if (RED.settings.verbose) { node.log(cmd+" ["+arg+"]"); }
                child = spawn(cmd,arg);
                if (node.timer !== 0) {
                    child.tout = setTimeout(function() { cleanup(child.pid); }, node.timer);
                }
                node.activeProcesses[child.pid] = child;
                child.stdout.on('data', function (data) {
                    //console.log('[exec] stdout: ' + data);
                    if (isUtf8(data)) { msg.payload = data.toString(); }
                    else { msg.payload = data; }
                    node.send([msg,null,null]);
                });
                child.stderr.on('data', function (data) {
                    //console.log('[exec] stderr: ' + data);
                    if (isUtf8(data)) { msg.payload = data.toString(); }
                    else { msg.payload = new Buffer(data); }
                    node.send([null,msg,null]);
                });
                child.on('close', function (code) {
                    //console.log('[exec] result: ' + code);
                    delete node.activeProcesses[child.pid];
                    if (child.tout) { clearTimeout(child.tout); }
                    msg.payload = code;
                    if (code === 0) { node.status({}); }
                    if (code === null) { node.status({fill:"red",shape:"dot",text:"timeout"}); }
                    else if (code < 0) { node.status({fill:"red",shape:"dot",text:"rc: "+code}); }
                    else { node.status({fill:"yellow",shape:"dot",text:"rc: "+code}); }
                    node.send([null,null,msg]);
                });
                child.on('error', function (code) {
                    delete node.activeProcesses[child.pid];
                    if (child.tout) { clearTimeout(child.tout); }
                    node.error(code,msg);
                });
            }
            else {
                var cl = node.cmd;
                if ((node.addpay === true) && msg.hasOwnProperty("payload")) { cl += " "+msg.payload; }
                if (node.append.trim() !== "") { cl += " "+node.append; }
                /* istanbul ignore else  */
                if (RED.settings.verbose) { node.log(cl); }
                child = exec(cl, {encoding: 'binary', maxBuffer:10000000}, function (error, stdout, stderr) {
                    msg.payload = new Buffer(stdout,"binary");
                    if (isUtf8(msg.payload)) { msg.payload = msg.payload.toString(); }
                    var msg2 = {payload:stderr};
                    var msg3 = null;
                    //console.log('[exec] stdout: ' + stdout);
                    //console.log('[exec] stderr: ' + stderr);
                    if (error !== null) {
                        msg3 = {payload:error};
                        //console.log('[exec] error: ' + error);
                    }
                    node.status({});
                    node.send([msg,msg2,msg3]);
                    if (child.tout) { clearTimeout(child.tout); }
                    delete node.activeProcesses[child.pid];
                });
                child.on('error',function() {});
                if (node.timer !== 0) {
                    child.tout = setTimeout(function() { cleanup(child.pid); }, node.timer);
                }
                node.activeProcesses[child.pid] = child;
            }
        });
        this.on('close',function() {
            for (var pid in node.activeProcesses) {
                /* istanbul ignore else  */
                if (node.activeProcesses.hasOwnProperty(pid)) {
                    if (node.activeProcesses[pid].tout) { clearTimeout(node.activeProcesses[pid].tout); }
                    node.activeProcesses[pid].kill();
                }
            }
            node.activeProcesses = {};
            node.status({});
        });
    }
    RED.nodes.registerType("exec",ExecNode);
}