AWS_PROFILE=default

install:
	npm install

build:
	npx tsc
	rm output.yml
	npx cdk synth > output.yml

deploy:
	npx cdk deploy --profile $(AWS_PROFILE)

delete:
	npx cdk destroy --profile $(AWS_PROFILE)