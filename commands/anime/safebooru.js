const { Command } = require('discord.js-commando');
const Discord = require('discord.js');
const booru = require('booru');

//remember to return before every promise
module.exports = class SafeBooruCommand extends Command {
    constructor(client) {
        super(client, {
            name: 'safebooru',
            aliases: ['sb', 'safe'],
            group: 'anime',
            memberName: 'safebooru',
            description: 'Searches for images on Safebooru!',
            details: 'Keep in mind Safebooru\'s definition of safe!',
            examples: ['~safebooru [search]'],
            throttling: {
                usages: 1,
                duration: 3
            }
        });
    }

    run (message) {
        var query = message.content.split(/\s+/g).slice(1).join(" ");
        booru.search('safebooru', [query], {limit: 1, random: true})
         .then(booru.commonfy)
         .then(images => {
             for(let image of images) {
                 const embed = new Discord.MessageEmbed()
                    .setAuthor(`Safebooru ${query}`, 'https://a.safe.moe/ppHw0.png')
                    .setImage(image.common.file_url)
                    .setColor('#C597B8');
                 return message.channel.send({embed});
             }

         }).catch(err => {
             if(err.name === 'booruError') {
                 return message.channel.send(`No results found for ${query}.`);
             } else {
                 return message.channel.send(`No results found for ${query}.`);
             }
         })
	}
}