const crypto = require("crypto");

const azureIdentity = require("@azure/identity");
const appConfig = require("@azure/app-configuration");
const keyVault = require("@azure/keyvault-secrets");
const storageBlob = require("@azure/storage-blob");
const azureCommunication = require("@azure/communication-email");

const OpenAI = require("openai");
const imageminPng = require("imagemin-pngquant");

module.exports = async function (context, myTimer) {
	try {
		context.log("ai-digital-picture-frame function running...");
		
		const azureCredential = new azureIdentity.DefaultAzureCredential();
		const configuration = await getConfiguration(azureCredential);
		
		const imagemin = (await import('imagemin')).default;
		const containerClient = getContainerClient(azureCredential);
		
		const images = await generateImages(configuration);
		for (const image of images) {
			await uploadToStorage(configuration, containerClient, image);
			await compressImage(imagemin, image);
			await emailImage(image, configuration, azureCredential);
		}

		context.log("ai-digital-picture-frame function done");
	} catch (error) {
		context.log.error(error);
		context.log("ai-digital-picture-frame function failed, exiting");
		throw error;
	}
};

async function getConfiguration(azureCredential) {
	const appConfigClient = new appConfig.AppConfigurationClient("https://app-configuration-7298.azconfig.io", azureCredential);
	
	const { value: openAIGenerateParams } = await appConfigClient.getConfigurationSetting({ key: "OpenAIGenerateParams" });
	const { value: openAISecretKey } = await getSecretKey(appConfigClient, azureCredential, "OpenAISecretKey");
	const { value: communicationServiceConnectionString } = await getSecretKey(appConfigClient, azureCredential, "CommunicationServiceConnectionString");
	const { value: senderEmailAddress } = await appConfigClient.getConfigurationSetting({ key: "SenderEmailAddress" });
	const { value: pictureFrameEmailAddress } = await appConfigClient.getConfigurationSetting({ key: "PictureFrameEmailAddress" });

	return {
		openAIGenerateParams: JSON.parse(openAIGenerateParams),
		openAISecretKey,
		communicationServiceConnectionString,
		senderEmailAddress,
		pictureFrameEmailAddress
	};
}

async function getSecretKey(appConfigClient, azureCredential, key) {
	const response = await appConfigClient.getConfigurationSetting({ key });
	const parsedSecretReference = appConfig.parseSecretReference(response);
	const { name: secretName, vaultUrl } = keyVault.parseKeyVaultSecretIdentifier(parsedSecretReference.value.secretId);

	const secretClient = new keyVault.SecretClient(vaultUrl, azureCredential);
	const secretKey = await secretClient.getSecret(secretName);
	return secretKey;
}

async function generateImages(configuration) {
	const openAIClient = new OpenAI({ apiKey: configuration.openAISecretKey });
	
	const response = await openAIClient.images.generate(configuration.openAIGenerateParams);
	
	const images = response.data.map(x => {
		const id = crypto.randomUUID();
		return {
			id,
			name: `${id}.png`,
			base64: x.b64_json
		};
	});

	return images;
}

function getContainerClient(azureCredential) {
	const blobServiceClient = new storageBlob.BlobServiceClient("https://storageaccount23487.blob.core.windows.net", azureCredential);
	const containerClient = blobServiceClient.getContainerClient("ai-generated-images");
	return containerClient;
}

async function uploadToStorage(configuration, containerClient, image) {
	const blockBlobClient = containerClient.getBlockBlobClient(image.name);
	const buffer = Buffer.from(image.base64, "base64");
	const metadata = { prompt: configuration.openAIGenerateParams.prompt };
	await blockBlobClient.upload(buffer, buffer.length, { metadata });
}

async function compressImage(imagemin, image) {
	const buffer = Buffer.from(image.base64, "base64");

	const compressedBuffer = await imagemin.buffer(buffer, {
		plugins: [
			imageminPng({ quality: [0, 1] })
		]
	});

	image.compressedBase64 = compressedBuffer.toString("base64");
}

async function emailImage(image, configuration) {
	const emailClient = new azureCommunication.EmailClient(configuration.communicationServiceConnectionString);
	const message = {
		senderAddress: configuration.senderEmailAddress,
		content: {
			subject: "Image for Picture Frame",
			plainText: "Image is attached."
		},
		recipients: {
			to: [
				{
					address: configuration.pictureFrameEmailAddress,
					displayName: "Picture Frame"
				}
			]
		},
		attachments: [
			{
				name: image.name,
				contentType: "image/png",
				contentInBase64: image.compressedBase64
			}
		]
	};
	  
	const poller = await emailClient.beginSend(message);
	await poller.pollUntilDone();  
}