'use strict';

const ICON_SIZE = 32;

const DEFAULT_ICON_TEXT = ` ##############################
################################
##                            ##
##                            ##
##          ########          ##
##        ############        ##
##       ####      ####       ##
##      ###          ###      ##
##     ###                    ##
##     ###                    ##
##    ###                     ##
##    ###                     ##
##    ###                     ##
##    ###                     ##
##    ###                     ##
##    ###                     ##
##    ###                     ##
##    ###                     ##
##    ###                     ##
##    ###                     ##
##     ###                    ##
##     ###                    ##
##      ###          ###      ##
##       ####      ####       ##
##        ############        ##
##          ########          ##
##                            ##
##                            ##
##                            ##
##                            ##
################################
 ##############################`;

const C_EXTENSIONS = new Set(['.c', '.h', '.s', '.S', '.ld']);
const AURIC_EXTENSIONS = new Set(['.aur']);
const EDITABLE_EXTENSIONS = new Set([
  '.c', '.h', '.s', '.S', '.aur', '.txt', '.md', '.json', '.ini', '.ld',
  '.py', '.sh', '.mk', '.cfg', '.gitignore'
]);

function isEditableFile(name) {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return true;
  return EDITABLE_EXTENSIONS.has(name.slice(dot));
}

function languageForFile(name) {
  if (name.endsWith('.aur')) return 'auric';
  if (/\.(c|h)$/i.test(name)) return 'c';
  if (/\.(s|ld)$/i.test(name)) return 'asm';
  if (name.endsWith('.json')) return 'json';
  if (name.endsWith('.md')) return 'markdown';
  return 'text';
}

module.exports = {
  ICON_SIZE,
  DEFAULT_ICON_TEXT,
  C_EXTENSIONS,
  AURIC_EXTENSIONS,
  EDITABLE_EXTENSIONS,
  isEditableFile,
  languageForFile
};
