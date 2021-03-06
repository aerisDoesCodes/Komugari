const escapeMarkdown = require('discord.js').escapeMarkdown;
const { oneLine, stripIndents } = require('common-tags');

/** A fancy argument */
class Argument {
	/**
	 * @typedef {Object} ArgumentInfo
	 * @property {string} key - Key for the argument
	 * @property {string} [label=key] - Label for the argument
	 * @property {string} prompt - First prompt for the argument when it wasn't specified
	 * @property {string} [type] - Type of the argument (must be the ID of one of the registered argument types -
	 * see {@link CommandRegistry#registerDefaultTypes} for the built-in types)
	 * @property {number} [max] - If type is `integer` or `float`, this is the maximum value of the number.
	 * If type is `string`, this is the maximum length of the string.
	 * @property {number} [min] - If type is `integer` or `float`, this is the minimum value of the number.
	 * If type is `string`, this is the minimum length of the string.
	 * @property {*} [default] - Default value for the argument (makes the argument optional - cannot be `null`)
	 * @property {boolean} [infinite=false] - Whether the argument accepts infinite values
	 * @property {Function} [validate] - Validator function for the argument (see {@link ArgumentType#validate})
	 * @property {Function} [parse] - Parser function for the argument (see {@link ArgumentType#parse})
	 * @property {number} [wait=30] - How long to wait for input (in seconds)
	 */

	/**
	 * @param {CommandoClient} client - Client the argument is for
	 * @param {ArgumentInfo} info - Information for the command argument
	 */
	constructor(client, info) {
		this.constructor.validateInfo(client, info);

		/**
		 * Key for the argument
		 * @type {string}
		 */
		this.key = info.key;

		/**
		 * Label for the argument
		 * @type {string}
		 */
		this.label = info.label || info.key;

		/**
		 * Question prompt for the argument
		 * @type {string}
		 */
		this.prompt = info.prompt;

		/**
		 * Type of the argument
		 * @type {?ArgumentType}
		 */
		this.type = info.type ? client.registry.types.get(info.type) : null;

		/**
		 * If type is `integer` or `float`, this is the maximum value of the number.
		 * If type is `string`, this is the maximum length of the string.
		 * @type {?number}
		 */
		this.max = info.max || null;

		/**
		 * If type is `integer` or `float`, this is the minimum value of the number.
		 * If type is `string`, this is the minimum length of the string.
		 * @type {?number}
		 */
		this.min = info.min || null;

		/**
		 * The default value for the argument
		 * @type {?*}
		 */
		this.default = typeof info.default !== 'undefined' ? info.default : null;

		/**
		 * Whether the argument accepts an infinite number of values
		 * @type {boolean}
		 */
		this.infinite = Boolean(info.infinite);

		/**
		 * Validator function for validating a value for the argument
		 * @type {?Function}
		 * @see {@link ArgumentType#validate}
		 */
		this.validator = info.validate || null;

		/**
		 * Parser function for parsing a value for the argument
		 * @type {?Function}
		 * @see {@link ArgumentType#parse}
		 */
		this.parser = info.parse || null;

		/**
		 * How long to wait for input (in seconds)
		 * @type {number}
		 */
		this.wait = typeof info.wait !== 'undefined' ? info.wait : 30;
	}

	/**
	 * Result object from obtaining a single {@link Argument}'s value(s)
	 * @typedef {Object} ArgumentResult
	 * @property {?*|?Array<*>} value - Final value(s) for the argument
	 * @property {?string} cancelled - One of:
	 * - `user` (user cancelled)
	 * - `time` (wait time exceeded)
	 * - `promptLimit` (prompt limit exceeded)
	 * @property {Message[]} prompts - All messages that were sent to prompt the user
	 * @property {Message[]} answers - All of the user's messages that answered a prompt
	 */

	/**
	 * Prompts the user and obtains the value for the argument
	 * @param {CommandMessage} msg - Message that triggered the command
	 * @param {string} [value] - Pre-provided value for the argument
	 * @param {number} [promptLimit=Infinity] - Maximum number of times to prompt for the argument
	 * @return {Promise<ArgumentResult>}
	 */
	async obtain(msg, value, promptLimit = Infinity) {
		if(!value && this.default !== null) {
			return {
				value: this.default,
				cancelled: null,
				prompts: [],
				answers: []
			};
		}
		if(this.infinite) return this.obtainInfinite(msg, value, promptLimit);

		const wait = this.wait > 0 && this.wait !== Infinity ? this.wait * 1000 : undefined;
		const prompts = [];
		const answers = [];
		let valid = value ? await this.validate(value, msg) : false;

		while(!valid || typeof valid === 'string') {
			/* eslint-disable no-await-in-loop */
			if(prompts.length >= promptLimit) {
				return {
					value: null,
					cancelled: 'promptLimit',
					prompts,
					answers
				};
			}

			// Prompt the user for a new value
			prompts.push(await msg.channel.send(stripIndents`
				${!value ? `**${this.prompt}**` : valid ? valid : `You provided an invalid **${this.label}**! Please try again!`}
				${oneLine`
					Respond with \`cancel\` to cancel the command,
					${wait ? `which will automatically be cancelled in ${this.wait} seconds!` : ''}
				`}
			`))

			// Get the user's response
			const responses = await msg.channel.awaitMessages(msg2 => msg2.author.id === msg.author.id, {
				max: 1,
				time: wait
			});

			// Make sure they actually answered
			if(responses && responses.size === 1) {
				answers.push(responses.first());
				value = answers[answers.length - 1].content;
			} else {
				return {
					value: null,
					cancelled: 'time',
					prompts,
					answers
				};
			}

			// See if they want to cancel
			if(value.toLowerCase() === 'cancel') {
				return {
					value: null,
					cancelled: 'user',
					prompts,
					answers
				};
			}

			valid = await this.validate(value, msg);
			/* eslint-enable no-await-in-loop */
		}

		return {
			value: await this.parse(value, msg),
			cancelled: null,
			prompts,
			answers
		};
	}

	/**
	 * Prompts the user and obtains multiple values for the argument
	 * @param {CommandMessage} msg - Message that triggered the command
	 * @param {string[]} [values] - Pre-provided values for the argument
	 * @param {number} [promptLimit=Infinity] - Maximum number of times to prompt for the argument
	 * @return {Promise<ArgumentResult>}
	 * @private
	 */
	async obtainInfinite(msg, values, promptLimit = Infinity) { // eslint-disable-line complexity
		const wait = this.wait > 0 && this.wait !== Infinity ? this.wait * 1000 : undefined;
		const results = [];
		const prompts = [];
		const answers = [];
		let currentVal = 0;

		while(true) { // eslint-disable-line no-constant-condition
			/* eslint-disable no-await-in-loop */
			let value = values && values[currentVal] ? values[currentVal] : null;
			let valid = value ? await this.validate(value, msg) : false;
			let attempts = 0;

			while(!valid || typeof valid === 'string') {
				attempts++;
				if(attempts > promptLimit) {
					return {
						value: null,
						cancelled: 'promptLimit',
						prompts,
						answers
					};
				}

				// Prompt the user for a new value
				if(value) {
					const escaped = escapeMarkdown(value).replace(/@/g, '@\u200b');
					prompts.push(await msg.channel.send(stripIndents`
						${valid ? valid : oneLine`
							You provided an invalid ${this.label},
							"${escaped.length < 1850 ? escaped : '[too long to show]'}".
							Please try again!
						`}
						${oneLine`
							Respond with \`cancel\` to cancel the command, or \`finish\` to finish entry up to this point.
							${wait ? `Which will automatically be cancelled in ${this.wait} seconds.` : ''}
						`}
					`));
				} else if(results.length === 0) {
					prompts.push(await msg.channel.send(stripIndents`
						${this.prompt}
						${oneLine`
							Respond with \`cancel\` to cancel the command, or \`finish\` to finish your entry!
							${wait ? `Which will automatically be cancelled in ${this.wait} seconds, unless you respond.` : ''}
						`}
					`));
				}

				// Get the user's response
				const responses = await msg.channel.awaitMessages(msg2 => msg2.author.id === msg.author.id, {
					max: 1,
					time: wait
				});

				// Make sure they actually answered
				if(responses && responses.size === 1) {
					answers.push(responses.first());
					value = answers[answers.length - 1].content;
				} else {
					return {
						value: null,
						cancelled: 'time',
						prompts,
						answers
					};
				}

				// See if they want to finish or cancel
				const lc = value.toLowerCase();
				if(lc === 'finish') {
					return {
						value: results.length > 0 ? results : null,
						cancelled: results.length > 0 ? null : 'user',
						prompts,
						answers
					};
				}
				if(lc === 'cancel') {
					return {
						value: null,
						cancelled: 'user',
						prompts,
						answers
					};
				}

				valid = await this.validate(value, msg);
			}

			results.push(await this.parse(value, msg));

			if(values) {
				currentVal++;
				if(currentVal === values.length) {
					return {
						value: results,
						cancelled: null,
						prompts,
						answers
					};
				}
			}
			/* eslint-enable no-await-in-loop */
		}
	}

	/**
	 * Checks if a value is valid for the argument
	 * @param {string} value - Value to check
	 * @param {CommandMessage} msg - Message that triggered the command
	 * @return {boolean|string|Promise<boolean|string>}
	 */
	validate(value, msg) {
		if(this.validator) return this.validator(value, msg, this);
		return this.type.validate(value, msg, this);
	}

	/**
	 * Parses a value string into a proper value for the argument
	 * @param {string} value - Value to parse
	 * @param {CommandMessage} msg - Message that triggered the command
	 * @return {*|Promise<*>}
	 */
	parse(value, msg) {
		if(this.parser) return this.parser(value, msg, this);
		return this.type.parse(value, msg, this);
	}

	/**
	 * Validates the constructor parameters
	 * @param {CommandoClient} client - Client to validate
	 * @param {ArgumentInfo} info - Info to validate
	 * @private
	 */
	static validateInfo(client, info) {
		if(!client) throw new Error('The argument client must be specified.');
		if(typeof info !== 'object') throw new TypeError('Argument info must be an Object.');
		if(typeof info.key !== 'string') throw new TypeError('Argument key must be a string.');
		if(info.label && typeof info.label !== 'string') throw new TypeError('Argument label must be a string.');
		if(typeof info.prompt !== 'string') throw new TypeError('Argument prompt must be a string.');
		if(!info.type && !info.validate) {
			throw new Error('Argument must have either "type" or "validate" specified.');
		}
		if(info.type && !client.registry.types.has(info.type)) {
			throw new RangeError(`Argument type "${info.type}" isn't registered.`);
		}
		if(info.validate && typeof info.validate !== 'function') {
			throw new TypeError('Argument validate must be a function.');
		}
		if(info.parse && typeof info.parse !== 'function') {
			throw new TypeError('Argument parse must be a function.');
		}
		if(!info.type && (!info.validate || !info.parse)) {
			throw new Error('Argument must have both validate and parse since it doesn\'t have a type.');
		}
		if(typeof info.wait !== 'undefined' && (typeof info.wait !== 'number' || Number.isNaN(info.wait))) {
			throw new TypeError('Argument wait must be a number.');
		}
	}
}

module.exports = Argument;
