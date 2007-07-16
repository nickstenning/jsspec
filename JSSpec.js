// defining namespace
JSSpec = {
	specs: []
}



// Browser detection code
JSSpec.Browser = {
	Trident: navigator.appName == "Microsoft Internet Explorer",
	Webkit: navigator.userAgent.indexOf('AppleWebKit/') > -1,
	Gecko: navigator.userAgent.indexOf('Gecko') > -1 && navigator.userAgent.indexOf('KHTML') == -1,
	Presto: navigator.appName == "Opera"
}



// Exception handler for Trident. It helps to collect exact line number where exception occured.
JSSpec.Executor = function(target, onSuccess, onException) {
	this.target = target;
	this.onSuccess = typeof onSuccess == 'function' ? onSuccess : function() {};
	this.onException = typeof onException == 'function' ? onException : function() {};
	
	if(JSSpec.Browser.Trident) {
		window.onerror = function(message, fileName, lineNumber) {
			var self = window._curExecutor;
			var ex = {message:message, fileName:fileName, lineNumber:lineNumber};

			if(JSSpec._secondPass)  {
				ex = self.mergeExceptions(JSSpec._assertionFailure, ex);
				delete JSSpec._secondPass;
				delete JSSpec._assertionFailure;
				
				self.onException(self, ex);
			} else if(JSSpec._assertionFailure) {
				JSSpec._secondPass = true;
				self.run();
			} else {
				self.onException(self, ex);
			}
			
			return true;
		}
	}
}
JSSpec.Executor.prototype.mergeExceptions = function(assertionFailure, normalException) {
	var merged = {
		message:assertionFailure.message,
		fileName:normalException.fileName,
		lineNumber:normalException.lineNumber,
		expected:assertionFailure.expected,
		actual:assertionFailure.actual
	};
	
	return merged;
}
JSSpec.Executor.prototype.run = function() {
	var self = this;
	var target = this.target;
	var onSuccess = this.onSuccess;
	var onException = this.onException;
	
	window.setTimeout(
		function() {
			if(JSSpec.Browser.Trident) {
				window._curExecutor = self;
				
				var result = self.target();
				self.onSuccess(self, result);
			} else {
				try {
					var result = self.target();
					self.onSuccess(self, result);
				} catch(ex) {
					if(JSSpec.Browser.Webkit) ex = {message:ex.message, fileName:ex.sourceUrl, lineNumber:ex.line}
					
					if(JSSpec._secondPass)  {
						ex = self.mergeExceptions(JSSpec._assertionFailure, ex);
						delete JSSpec._secondPass;
						delete JSSpec._assertionFailure;
						
						self.onException(self, ex);
					} else if(JSSpec._assertionFailure) {
						JSSpec._secondPass = true;
						self.run();
					} else {
						self.onException(self, ex);
					}
				}
			}
		},
		0
	);
}



// CompositeExecutor composites one or more executors and execute them sequencially.
JSSpec.CompositeExecutor = function(onSuccess, onException, continueOnException) {
	this.queue = [];
	this.onSuccess = typeof onSuccess == 'function' ? onSuccess : function() {};
	this.onException = typeof onException == 'function' ? onException : function() {};
	this.continueOnException = !!continueOnException;
}
JSSpec.CompositeExecutor.prototype.addFunction = function(func) {
	this.addExecutor(new JSSpec.Executor(func));
}
JSSpec.CompositeExecutor.prototype.addExecutor = function(executor) {
	var last = this.queue.length == 0 ? null : this.queue[this.queue.length - 1];
	if(last) {
		last.next = executor;
	}
	
	executor.parent = this;
	executor.onSuccessBackup = executor.onSuccess;
	executor.onSuccess = function(result) {
		this.onSuccessBackup(result);
		if(this.next) {
			this.next.run()
		} else {
			this.parent.onSuccess();
		}
	}
	executor.onExceptionBackup = executor.onException;
	executor.onException = function(executor, ex) {
		this.onExceptionBackup(executor, ex);

		if(this.parent.continueOnException) {
			if(this.next) {
				this.next.run()
			} else {
				this.parent.onSuccess();
			}
		} else {
			this.parent.onException(executor, ex);
		}
	}

	this.queue.push(executor);
}
JSSpec.CompositeExecutor.prototype.run = function() {
	if(this.queue.length > 0) {
		this.queue[0].run();
	}
}



// Spec is a set of Examples in a specific context
JSSpec.Spec = function(context, entries) {
	this.id = JSSpec.Spec.id++;
	this.context = context;
	
	this.extractOutSpecialEntries(entries);
	this.examples = this.makeExamplesFromEntries(entries);
}
JSSpec.Spec.id = 0;
JSSpec.Spec.prototype.getExamples = function() {
	return this.examples;
}
JSSpec.Spec.prototype.extractOutSpecialEntries = function(entries) {
	this.beforeEach = function() {};
	this.beforeAll = function() {};
	this.afterEach = function() {};
	this.afterAll = function() {};
	
	for(name in entries) {
		if(name == 'before' || name == 'before each') {
			this.beforeEach = entries[name];
		} else if(name == 'before all') {
			this.beforeAll = entries[name];
		} else if(name == 'after' || name == 'after each') {
			this.afterEach = entries[name];
		} else if(name == 'after all') {
			this.afterAll = entries[name];
		}
	}
	
	delete entries['before'];
	delete entries['before each'];
	delete entries['before all'];
	delete entries['after'];
	delete entries['after each'];
	delete entries['after all'];
}
JSSpec.Spec.prototype.makeExamplesFromEntries = function(entries) {
	var examples = [];
	for(name in entries) {
		examples.push(new JSSpec.Example(name, entries[name], this.beforeEach, this.afterEach));
	}
	return examples;
}
JSSpec.Spec.prototype.getExecutor = function() {
	var self = this;
	var onException = function(executor, ex) {self.exception = ex}
	
	var composite = new JSSpec.CompositeExecutor();
	composite.addFunction(function() {JSSpec.log.onSpecStart(self)});
	composite.addExecutor(new JSSpec.Executor(this.beforeAll, null, function(exec, ex) {
		self.exception = ex;
		JSSpec.log.onSpecEnd(self);
	}));
	
	var exampleAndAfter = new JSSpec.CompositeExecutor(null,null,true);
	for(var i = 0; i < this.examples.length; i++) {
		exampleAndAfter.addExecutor(this.examples[i].getExecutor());
	}
	exampleAndAfter.addExecutor(new JSSpec.Executor(this.afterAll, null, onException));
	exampleAndAfter.addFunction(function() {JSSpec.log.onSpecEnd(self)});
	composite.addExecutor(exampleAndAfter);
	
	return composite;
}




// Example
JSSpec.Example = function(name, target, before, after) {
	this.id = JSSpec.Example.id++;
	this.name = name;
	this.target = target;
	this.before = before;
	this.after = after;
}
JSSpec.Example.id = 0;
JSSpec.Example.prototype.getExecutor = function() {
	var self = this;
	var onException = function(executor, ex) {
		self.exception = ex
	}
	
	var composite = new JSSpec.CompositeExecutor();
	composite.addFunction(function() {JSSpec.log.onExampleStart(self)});
	composite.addExecutor(new JSSpec.Executor(this.before, null, function(exec, ex) {
		self.exception = ex;
		JSSpec.log.onExampleEnd(self);
	}));
	
	var targetAndAfter = new JSSpec.CompositeExecutor(null,null,true);
	
	targetAndAfter.addExecutor(new JSSpec.Executor(this.target, null, onException));
	targetAndAfter.addExecutor(new JSSpec.Executor(this.after, null, onException));
	targetAndAfter.addFunction(function() {JSSpec.log.onExampleEnd(self)});
	
	composite.addExecutor(targetAndAfter);
	
	return composite;
}


JSSpec.Runner = function(specs, logger) {
	JSSpec.log = logger;
	this.specs = specs;
}
JSSpec.Runner.prototype.getSpecs = function() {
	return this.specs;
}
JSSpec.Runner.prototype.run = function() {
	JSSpec.log.onRunnerStart();
	var executor = new JSSpec.CompositeExecutor(function() {JSSpec.log.onRunnerEnd()},null,true);
	for(var i = 0; i < this.specs.length; i++) {
		executor.addExecutor(this.specs[i].getExecutor());
	}
	executor.run();
}



// Logger
JSSpec.Logger = function() {}

JSSpec.Logger.prototype.onRunnerStart = function() {
	var summary = document.createElement("H1");
	summary.id = "summary";
	summary.className = "ongoing";
	summary.innerHTML = 'JSSpec results - <span id="total_specs">0</span> specs / <span id="total_failures">0</span> failures / <span id="total_errors">0</span> errors';
	document.body.appendChild(summary);
	
	var specs = JSSpec.runner.getSpecs();
	document.getElementById("total_specs").innerHTML = specs.length;
	
	for(var i = 0; i < specs.length; i++) {
		var spec = specs[i];
		var div = document.createElement("DIV");
		div.id = "spec_" + spec.id;
		div.className = "waiting";
		document.body.appendChild(div);
		
		var heading = document.createElement("H2");
		heading.appendChild(document.createTextNode(spec.context));
		div.appendChild(heading);
		
		var examples = spec.getExamples();
		
		var ul = document.createElement("UL");
		div.appendChild(ul);
		
		for(var j = 0; j < examples.length; j++) {
			var example = examples[j];
			var li = document.createElement("LI");
			li.id = "example_" + example.id;
			li.className = "waiting";
			var p = document.createElement("P");
			p.appendChild(document.createTextNode(example.name));
			li.appendChild(p);
			ul.appendChild(li);
		}
	}
}
JSSpec.Logger.prototype.onRunnerEnd = function() {
	var summary = document.getElementById("summary");
	// TODO
	summary.className = "success";
}
JSSpec.Logger.prototype.onSpecStart = function(spec) {
	var div = document.getElementById("spec_" + spec.id);
	div.className = "ongoing";
}
JSSpec.Logger.prototype.onSpecEnd = function(spec) {
	var div = document.getElementById("spec_" + spec.id);
	div.className = spec.exception ? "exception" : "success";
}
JSSpec.Logger.prototype.onExampleStart = function(example) {
	var li = document.getElementById("example_" + example.id);
	li.className = "ongoing";
}
JSSpec.Logger.prototype.onExampleEnd = function(example) {
	var li = document.getElementById("example_" + example.id);
	li.className = example.exception ? "exception" : "success";
}



// Domain Specific Languages
JSSpec.DSL = {};
JSSpec.DSL.describe = function(context, entries) {
	JSSpec.specs.push(new JSSpec.Spec(context, entries));
}
JSSpec.DSL.assertion = {
	should:function() {
		if(JSSpec._secondPass) return {}
		
		var self = this;
		return {
			be: function(expected) {
				if(self != expected) {
					JSSpec._assertionFailure = {message:"AssertionFailure", expected:expected, actual:self};
					throw JSSpec._assertionFailure;
				}
			}
		}
	}
}

describe = JSSpec.DSL.describe;

String.prototype.should = JSSpec.DSL.assertion.should;



// Main
window.onload = function() {
	JSSpec.runner = new JSSpec.Runner(JSSpec.specs, new JSSpec.Logger());
	JSSpec.runner.run();
}